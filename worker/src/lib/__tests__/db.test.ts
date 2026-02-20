import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import {
  createPhrase,
  getPhrase,
  getPhraseForUser,
  listPhrases,
  listPhrasesForUser,
  getExportablePhrases,
  getExportablePhrasesForUser,
  updatePhrase,
  updatePhraseForUser,
  deletePhrase,
  deletePhraseForUser,
  markPhrasesExported,
  markPhrasesExportedForUser,
  setCurrentJobForUser,
} from "../db";
import { randomId } from "../../__tests__/factories";
import type { PhraseStatus } from "../../types";

/**
 * Database Multi-Tenant Isolation Tests
 *
 * Tests that all user-scoped database operations properly isolate data
 * between users. Critical for preventing data leaks.
 */

describe("Database Multi-Tenant Isolation", () => {
  const userAlice = "user-alice";
  const userBob = "user-bob";
  const userCharlie = "user-charlie";

  describe("createPhrase", () => {
    it("creates phrase with user_id", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Hello", "ru");

      const row = await env.DB.prepare("SELECT * FROM phrases WHERE id = ?")
        .bind(phraseId)
        .first();

      expect(row).toBeTruthy();
      expect(row!.id).toBe(phraseId);
      expect(row!.user_id).toBe(userAlice);
      expect(row!.source_text).toBe("Hello");
      expect(row!.detected_language).toBe("ru");
      expect(row!.status).toBe("processing");
    });

    it("creates phrases for different users independently", async () => {
      const phraseIdAlice = randomId("phrase");
      const phraseIdBob = randomId("phrase");

      await createPhrase(env, userAlice, phraseIdAlice, "text", null, "Alice text", "ru");
      await createPhrase(env, userBob, phraseIdBob, "text", null, "Bob text", "ru");

      const phraseAlice = await env.DB.prepare("SELECT * FROM phrases WHERE id = ?")
        .bind(phraseIdAlice)
        .first();
      const phraseBob = await env.DB.prepare("SELECT * FROM phrases WHERE id = ?")
        .bind(phraseIdBob)
        .first();

      expect(phraseAlice!.user_id).toBe(userAlice);
      expect(phraseBob!.user_id).toBe(userBob);
      expect(phraseAlice!.source_text).toBe("Alice text");
      expect(phraseBob!.source_text).toBe("Bob text");
    });
  });

  describe("getPhraseForUser", () => {
    it("returns phrase owned by user", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Hello", "ru");

      const phrase = await getPhraseForUser(env, userAlice, phraseId);

      expect(phrase).toBeTruthy();
      expect(phrase!.id).toBe(phraseId);
      expect(phrase!.source_text).toBe("Hello");
    });

    it("does NOT return phrase owned by different user", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Alice's secret", "ru");

      const phrase = await getPhraseForUser(env, userBob, phraseId);

      expect(phrase).toBeNull();
    });

    it("does NOT return phrase with NULL user_id (orphaned rows are invisible)", async () => {
      const phraseId = randomId("phrase");
      await env.DB.prepare(`
        INSERT INTO phrases (id, user_id, source_type, source_text, status, created_at)
        VALUES (?, NULL, 'text', 'Legacy phrase', 'processing', ?)
      `).bind(phraseId, Date.now()).run();

      // NULL user_id phrases are orphaned and should NOT be accessible
      const phraseAlice = await getPhraseForUser(env, userAlice, phraseId);
      const phraseBob = await getPhraseForUser(env, userBob, phraseId);

      expect(phraseAlice).toBeNull();
      expect(phraseBob).toBeNull();
    });
  });

  describe("listPhrasesForUser", () => {
    beforeEach(async () => {
      // Create test phrases for multiple users
      await createPhrase(env, userAlice, randomId("phrase"), "text", null, "Alice 1", "ru");
      await createPhrase(env, userAlice, randomId("phrase"), "text", null, "Alice 2", "ru");
      await createPhrase(env, userBob, randomId("phrase"), "text", null, "Bob 1", "ru");
      await createPhrase(env, userBob, randomId("phrase"), "text", null, "Bob 2", "ru");
      await createPhrase(env, userCharlie, randomId("phrase"), "text", null, "Charlie 1", "ru");
    });

    it("only returns phrases for specified user", async () => {
      const phrases = await listPhrasesForUser(env, userAlice);

      expect(phrases.length).toBe(2);
      expect(phrases.every(p => p.source_text?.startsWith("Alice"))).toBe(true);
    });

    it("different users see different lists", async () => {
      const phrasesAlice = await listPhrasesForUser(env, userAlice);
      const phrasesBob = await listPhrasesForUser(env, userBob);

      expect(phrasesAlice.length).toBe(2);
      expect(phrasesBob.length).toBe(2);

      const aliceTexts = phrasesAlice.map(p => p.source_text);
      const bobTexts = phrasesBob.map(p => p.source_text);

      expect(aliceTexts).not.toEqual(bobTexts);
      expect(aliceTexts.every(t => t?.startsWith("Alice"))).toBe(true);
      expect(bobTexts.every(t => t?.startsWith("Bob"))).toBe(true);
    });

    it("filters by status per user", async () => {
      // Update Alice's first phrase to approved
      const phrasesAlice = await listPhrasesForUser(env, userAlice);
      await updatePhraseForUser(env, userAlice, phrasesAlice[0].id, { status: "approved" });

      const approved = await listPhrasesForUser(env, userAlice, "approved");
      const processing = await listPhrasesForUser(env, userAlice, "processing");

      expect(approved.length).toBe(1);
      expect(processing.length).toBe(1);
      expect(approved[0].status).toBe("approved");
      expect(processing[0].status).toBe("processing");
    });

    it("respects limit parameter", async () => {
      const phrases = await listPhrasesForUser(env, userAlice, undefined, 1);
      expect(phrases.length).toBe(1);
    });
  });

  describe("updatePhraseForUser", () => {
    it("updates phrase owned by user", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Original", "ru");

      await updatePhraseForUser(env, userAlice, phraseId, {
        source_text: "Updated by Alice",
        translation: "Translation",
      });

      const phrase = await getPhraseForUser(env, userAlice, phraseId);
      expect(phrase!.source_text).toBe("Updated by Alice");
      expect(phrase!.translation).toBe("Translation");
    });

    it("does NOT update phrase owned by different user", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Alice's original", "ru");

      // Bob tries to update Alice's phrase
      await updatePhraseForUser(env, userBob, phraseId, {
        source_text: "Hacked by Bob",
      });

      // Verify Alice's phrase is unchanged
      const phrase = await getPhraseForUser(env, userAlice, phraseId);
      expect(phrase!.source_text).toBe("Alice's original");
    });

    it("can update status to approved", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Text", "ru");

      await updatePhraseForUser(env, userAlice, phraseId, { status: "approved" });

      const phrase = await getPhraseForUser(env, userAlice, phraseId);
      expect(phrase!.status).toBe("approved");
      expect(phrase!.reviewed_at).toBeTruthy();
    });

    it("updates multiple fields at once", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Text", "ru");

      await updatePhraseForUser(env, userAlice, phraseId, {
        source_text: "New text",
        translation: "New translation",
        transliteration: "New transliteration",
        grammar_notes: "New notes",
        status: "pending_review",
      });

      const phrase = await getPhraseForUser(env, userAlice, phraseId);
      expect(phrase!.source_text).toBe("New text");
      expect(phrase!.translation).toBe("New translation");
      expect(phrase!.transliteration).toBe("New transliteration");
      expect(phrase!.grammar_notes).toBe("New notes");
      expect(phrase!.status).toBe("pending_review");
    });
  });

  describe("deletePhraseForUser", () => {
    it("deletes phrase owned by user", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "To delete", "ru");

      await deletePhraseForUser(env, userAlice, phraseId);

      const phrase = await getPhraseForUser(env, userAlice, phraseId);
      expect(phrase).toBeNull();
    });

    it("does NOT delete phrase owned by different user", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Alice's phrase", "ru");

      // Bob tries to delete Alice's phrase
      await deletePhraseForUser(env, userBob, phraseId);

      // Verify Alice's phrase still exists
      const phrase = await getPhraseForUser(env, userAlice, phraseId);
      expect(phrase).toBeTruthy();
      expect(phrase!.source_text).toBe("Alice's phrase");
    });

    it("only deletes specified phrase, not others", async () => {
      const phraseId1 = randomId("phrase");
      const phraseId2 = randomId("phrase");
      await createPhrase(env, userAlice, phraseId1, "text", null, "Phrase 1", "ru");
      await createPhrase(env, userAlice, phraseId2, "text", null, "Phrase 2", "ru");

      await deletePhraseForUser(env, userAlice, phraseId1);

      const phrase1 = await getPhraseForUser(env, userAlice, phraseId1);
      const phrase2 = await getPhraseForUser(env, userAlice, phraseId2);

      expect(phrase1).toBeNull();
      expect(phrase2).toBeTruthy();
    });
  });

  describe("getExportablePhrasesForUser", () => {
    beforeEach(async () => {
      // Alice: 2 approved (exportable), 1 approved (excluded), 1 pending_review
      const aliceApproved1 = randomId("phrase");
      const aliceApproved2 = randomId("phrase");
      const aliceExcluded = randomId("phrase");
      const alicePending = randomId("phrase");

      await createPhrase(env, userAlice, aliceApproved1, "text", null, "Alice approved 1", "ru");
      await createPhrase(env, userAlice, aliceApproved2, "text", null, "Alice approved 2", "ru");
      await createPhrase(env, userAlice, aliceExcluded, "text", null, "Alice excluded", "ru");
      await createPhrase(env, userAlice, alicePending, "text", null, "Alice pending", "ru");

      await updatePhraseForUser(env, userAlice, aliceApproved1, { status: "approved" });
      await updatePhraseForUser(env, userAlice, aliceApproved2, { status: "approved" });
      await updatePhraseForUser(env, userAlice, aliceExcluded, { status: "approved", exclude_from_export: true });

      // Bob: 1 approved (exportable)
      const bobApproved = randomId("phrase");
      await createPhrase(env, userBob, bobApproved, "text", null, "Bob approved", "ru");
      await updatePhraseForUser(env, userBob, bobApproved, { status: "approved" });
    });

    it("only returns approved phrases for user", async () => {
      const phrases = await getExportablePhrasesForUser(env, userAlice);

      expect(phrases.length).toBe(2);
      expect(phrases.every(p => p.status === "approved")).toBe(true);
      expect(phrases.every(p => p.source_text?.startsWith("Alice"))).toBe(true);
    });

    it("excludes phrases with exclude_from_export=true", async () => {
      const phrases = await getExportablePhrasesForUser(env, userAlice);

      const excludedFound = phrases.find(p => p.source_text === "Alice excluded");
      expect(excludedFound).toBeUndefined();
    });

    it("different users get different exportable lists", async () => {
      const phrasesAlice = await getExportablePhrasesForUser(env, userAlice);
      const phrasesBob = await getExportablePhrasesForUser(env, userBob);

      expect(phrasesAlice.length).toBe(2);
      expect(phrasesBob.length).toBe(1);
      expect(phrasesBob[0].source_text).toBe("Bob approved");
    });
  });

  describe("markPhrasesExportedForUser", () => {
    it("marks user's phrases as exported", async () => {
      const phraseId1 = randomId("phrase");
      const phraseId2 = randomId("phrase");

      await createPhrase(env, userAlice, phraseId1, "text", null, "Text 1", "ru");
      await createPhrase(env, userAlice, phraseId2, "text", null, "Text 2", "ru");
      await updatePhraseForUser(env, userAlice, phraseId1, { status: "approved" });
      await updatePhraseForUser(env, userAlice, phraseId2, { status: "approved" });

      await markPhrasesExportedForUser(env, userAlice, [phraseId1, phraseId2]);

      const phrase1 = await getPhraseForUser(env, userAlice, phraseId1);
      const phrase2 = await getPhraseForUser(env, userAlice, phraseId2);

      expect(phrase1!.status).toBe("exported");
      expect(phrase1!.exported_at).toBeTruthy();
      expect(phrase2!.status).toBe("exported");
      expect(phrase2!.exported_at).toBeTruthy();
    });

    it("does NOT mark other user's phrases as exported", async () => {
      const phraseIdAlice = randomId("phrase");
      const phraseIdBob = randomId("phrase");

      await createPhrase(env, userAlice, phraseIdAlice, "text", null, "Alice", "ru");
      await createPhrase(env, userBob, phraseIdBob, "text", null, "Bob", "ru");
      await updatePhraseForUser(env, userAlice, phraseIdAlice, { status: "approved" });
      await updatePhraseForUser(env, userBob, phraseIdBob, { status: "approved" });

      // Alice tries to mark Bob's phrase as exported
      await markPhrasesExportedForUser(env, userAlice, [phraseIdBob]);

      // Bob's phrase should be unchanged
      const phraseBob = await getPhraseForUser(env, userBob, phraseIdBob);
      expect(phraseBob!.status).toBe("approved");
      expect(phraseBob!.exported_at).toBeNull();
    });
  });

  describe("setCurrentJobForUser", () => {
    it("sets job ID for user's phrase", async () => {
      const phraseId = randomId("phrase");
      const jobId = randomId("job");

      await createPhrase(env, userAlice, phraseId, "text", null, "Text", "ru");
      await setCurrentJobForUser(env, userAlice, phraseId, jobId, true);

      const phrase = await getPhraseForUser(env, userAlice, phraseId);
      expect(phrase!.current_job_id).toBe(jobId);
      expect(phrase!.job_attempts).toBe(1);
      expect(phrase!.job_started_at).toBeTruthy();
      expect(phrase!.status).toBe("processing");
    });

    it("does NOT set job ID for different user's phrase", async () => {
      const phraseId = randomId("phrase");
      const jobId = randomId("job");

      await createPhrase(env, userAlice, phraseId, "text", null, "Alice", "ru");

      // Bob tries to set job for Alice's phrase
      await setCurrentJobForUser(env, userBob, phraseId, jobId, false);

      const phrase = await getPhraseForUser(env, userAlice, phraseId);
      // Should be unchanged
      expect(phrase!.current_job_id).toBeNull();
      expect(phrase!.job_attempts).toBe(0);
    });

    it("increments job_attempts on repeated calls", async () => {
      const phraseId = randomId("phrase");

      await createPhrase(env, userAlice, phraseId, "text", null, "Text", "ru");
      await setCurrentJobForUser(env, userAlice, phraseId, randomId("job"), false);
      await setCurrentJobForUser(env, userAlice, phraseId, randomId("job"), false);
      await setCurrentJobForUser(env, userAlice, phraseId, randomId("job"), false);

      const phrase = await getPhraseForUser(env, userAlice, phraseId);
      expect(phrase!.job_attempts).toBe(3);
    });
  });

  describe("Non-scoped functions (legacy)", () => {
    it("getPhrase returns any phrase regardless of user", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Alice's phrase", "ru");

      const phrase = await getPhrase(env, phraseId);
      expect(phrase).toBeTruthy();
      expect(phrase!.id).toBe(phraseId);
    });

    it("listPhrases returns all phrases regardless of user", async () => {
      await createPhrase(env, userAlice, randomId("phrase"), "text", null, "Alice", "ru");
      await createPhrase(env, userBob, randomId("phrase"), "text", null, "Bob", "ru");

      const phrases = await listPhrases(env);
      expect(phrases.length).toBeGreaterThanOrEqual(2);
    });

    it("updatePhrase updates any phrase regardless of user", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Original", "ru");

      // Update without user check
      await updatePhrase(env, phraseId, { source_text: "Updated" });

      const phrase = await getPhrase(env, phraseId);
      expect(phrase!.source_text).toBe("Updated");
    });

    it("deletePhrase deletes any phrase regardless of user", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "To delete", "ru");

      await deletePhrase(env, phraseId);

      const phrase = await getPhrase(env, phraseId);
      expect(phrase).toBeNull();
    });
  });

  describe("Cross-User Isolation Verification", () => {
    it("comprehensive isolation test: create, read, update, delete", async () => {
      // Setup: Create phrases for Alice and Bob
      const phraseIdAlice = randomId("phrase");
      const phraseIdBob = randomId("phrase");

      await createPhrase(env, userAlice, phraseIdAlice, "text", null, "Alice data", "ru");
      await createPhrase(env, userBob, phraseIdBob, "text", null, "Bob data", "ru");

      // READ: Each user can only read their own
      const aliceReadOwn = await getPhraseForUser(env, userAlice, phraseIdAlice);
      const aliceReadBobs = await getPhraseForUser(env, userAlice, phraseIdBob);
      const bobReadOwn = await getPhraseForUser(env, userBob, phraseIdBob);
      const bobReadAlices = await getPhraseForUser(env, userBob, phraseIdAlice);

      expect(aliceReadOwn).toBeTruthy();
      expect(aliceReadBobs).toBeNull(); // Alice cannot read Bob's
      expect(bobReadOwn).toBeTruthy();
      expect(bobReadAlices).toBeNull(); // Bob cannot read Alice's

      // UPDATE: Each user can only update their own
      await updatePhraseForUser(env, userAlice, phraseIdBob, { source_text: "Alice tries to hack Bob" });
      const bobPhraseAfterHack = await getPhraseForUser(env, userBob, phraseIdBob);
      expect(bobPhraseAfterHack!.source_text).toBe("Bob data"); // Unchanged

      await updatePhraseForUser(env, userAlice, phraseIdAlice, { source_text: "Alice updates own" });
      const alicePhraseAfterUpdate = await getPhraseForUser(env, userAlice, phraseIdAlice);
      expect(alicePhraseAfterUpdate!.source_text).toBe("Alice updates own");

      // DELETE: Each user can only delete their own
      await deletePhraseForUser(env, userAlice, phraseIdBob); // Try to delete Bob's
      const bobPhraseAfterDeleteAttempt = await getPhraseForUser(env, userBob, phraseIdBob);
      expect(bobPhraseAfterDeleteAttempt).toBeTruthy(); // Still exists

      await deletePhraseForUser(env, userAlice, phraseIdAlice); // Delete own
      const alicePhraseAfterDelete = await getPhraseForUser(env, userAlice, phraseIdAlice);
      expect(alicePhraseAfterDelete).toBeNull();
    });

    it("list operations never leak cross-user data", async () => {
      // Create 10 phrases for Alice, 10 for Bob
      for (let i = 0; i < 10; i++) {
        await createPhrase(env, userAlice, randomId("phrase"), "text", null, `Alice ${i}`, "ru");
        await createPhrase(env, userBob, randomId("phrase"), "text", null, `Bob ${i}`, "ru");
      }

      const aliceList = await listPhrasesForUser(env, userAlice);
      const bobList = await listPhrasesForUser(env, userBob);

      // Verify no cross-contamination
      expect(aliceList.length).toBeGreaterThanOrEqual(10);
      expect(bobList.length).toBeGreaterThanOrEqual(10);

      const aliceTexts = aliceList.map(p => p.source_text);
      const bobTexts = bobList.map(p => p.source_text);

      expect(aliceTexts.every(t => t?.startsWith("Alice"))).toBe(true);
      expect(bobTexts.every(t => t?.startsWith("Bob"))).toBe(true);

      // No overlap
      const aliceHasBobData = aliceTexts.some(t => t?.startsWith("Bob"));
      const bobHasAliceData = bobTexts.some(t => t?.startsWith("Alice"));

      expect(aliceHasBobData).toBe(false);
      expect(bobHasAliceData).toBe(false);
    });
  });
});
