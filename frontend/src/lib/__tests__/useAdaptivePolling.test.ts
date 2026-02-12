import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAdaptivePolling } from "../useAdaptivePolling";

// Helper to flush microtasks and timers
const flushPromises = () => new Promise((resolve) => {
  setImmediate(resolve);
});

describe("useAdaptivePolling", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("Basic Polling", () => {
    it("calls onPoll immediately on mount", async () => {
      const onPoll = vi.fn().mockResolvedValue(undefined);
      const shouldPollFast = vi.fn(() => false);

      await act(async () => {
        renderHook(() =>
          useAdaptivePolling({
            onPoll,
            shouldPollFast,
            fastInterval: 1000,
            slowInterval: 5000,
          })
        );
        await flushPromises();
      });

      expect(onPoll).toHaveBeenCalledTimes(1);
    });

    it("polls at fast interval when shouldPollFast returns true", async () => {
      const onPoll = vi.fn().mockResolvedValue(undefined);
      const shouldPollFast = vi.fn(() => true);

      await act(async () => {
        renderHook(() =>
          useAdaptivePolling({
            onPoll,
            shouldPollFast,
            fastInterval: 1000,
            slowInterval: 5000,
          })
        );
        await flushPromises();
      });

      expect(onPoll).toHaveBeenCalledTimes(1);

      // Advance by fast interval
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(onPoll).toHaveBeenCalledTimes(2);

      // Advance by another fast interval
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(onPoll).toHaveBeenCalledTimes(3);
    });

    it("polls at slow interval when shouldPollFast returns false", async () => {
      const onPoll = vi.fn().mockResolvedValue(undefined);
      const shouldPollFast = vi.fn(() => false);

      await act(async () => {
        renderHook(() =>
          useAdaptivePolling({
            onPoll,
            shouldPollFast,
            fastInterval: 1000,
            slowInterval: 5000,
          })
        );
        await flushPromises();
      });

      expect(onPoll).toHaveBeenCalledTimes(1);

      // Advance by fast interval (should NOT poll)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(onPoll).toHaveBeenCalledTimes(1);

      // Advance to slow interval
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });

      expect(onPoll).toHaveBeenCalledTimes(2);
    });
  });

  describe("Tab Visibility", () => {
    it("pauses polling when tab is hidden", async () => {
      const onPoll = vi.fn().mockResolvedValue(undefined);
      const shouldPollFast = vi.fn(() => true);

      Object.defineProperty(document, "hidden", {
        writable: true,
        configurable: true,
        value: false,
      });

      const { unmount } = await act(async () => {
        const result = renderHook(() =>
          useAdaptivePolling({
            onPoll,
            shouldPollFast,
            fastInterval: 1000,
            slowInterval: 5000,
            pauseWhenHidden: true,
          })
        );
        await flushPromises();
        return result;
      });

      expect(onPoll).toHaveBeenCalledTimes(1);

      // Hide tab
      act(() => {
        Object.defineProperty(document, "hidden", { value: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });

      // Advance time - should NOT poll while hidden
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(onPoll).toHaveBeenCalledTimes(1);

      unmount();
    });
  });

  describe("pollNow", () => {
    it.skip("triggers immediate poll when pollNow is called", async () => {
      const onPoll = vi.fn().mockResolvedValue(undefined);
      const shouldPollFast = vi.fn(() => false);

      const { result } = renderHook(() =>
        useAdaptivePolling({
          onPoll,
          shouldPollFast,
          fastInterval: 1000,
          slowInterval: 5000,
        })
      );

      await act(async () => {
        await flushPromises();
        await vi.runOnlyPendingTimersAsync();
      });

      expect(onPoll).toHaveBeenCalledTimes(1);

      // Call pollNow
      await act(async () => {
        await result.current.pollNow();
      });

      expect(onPoll).toHaveBeenCalledTimes(2);
    });
  });

  describe("Enabled/Disabled", () => {
    it("does not poll when enabled is false", async () => {
      const onPoll = vi.fn().mockResolvedValue(undefined);
      const shouldPollFast = vi.fn(() => true);

      await act(async () => {
        renderHook(() =>
          useAdaptivePolling({
            onPoll,
            shouldPollFast,
            fastInterval: 1000,
            slowInterval: 5000,
            enabled: false,
          })
        );
        await flushPromises();
      });

      expect(onPoll).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });

      expect(onPoll).not.toHaveBeenCalled();
    });
  });

  describe("Cleanup", () => {
    it.skip("clears timeout on unmount", async () => {
      const onPoll = vi.fn().mockResolvedValue(undefined);
      const shouldPollFast = vi.fn(() => true);

      const { unmount } = renderHook(() =>
        useAdaptivePolling({
          onPoll,
          shouldPollFast,
          fastInterval: 1000,
          slowInterval: 5000,
        })
      );

      await act(async () => {
        await flushPromises();
        await vi.runOnlyPendingTimersAsync();
      });

      expect(onPoll).toHaveBeenCalledTimes(1);

      // Unmount
      act(() => {
        unmount();
      });

      // Advance time - should NOT poll after unmount
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(onPoll).toHaveBeenCalledTimes(1);
    });
  });

  describe("Error Handling", () => {
    it.skip("continues polling after onPoll throws error", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      let callCount = 0;
      const onPoll = vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error("Test error"));
        }
        return Promise.resolve();
      });
      const shouldPollFast = vi.fn(() => true);

      renderHook(() =>
        useAdaptivePolling({
          onPoll,
          shouldPollFast,
          fastInterval: 1000,
          slowInterval: 5000,
        })
      );

      await act(async () => {
        await flushPromises();
        await vi.runOnlyPendingTimersAsync();
      });

      expect(onPoll).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith(
        "Polling error:",
        expect.any(Error)
      );

      // Should continue polling despite error
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(onPoll).toHaveBeenCalledTimes(2);

      consoleError.mockRestore();
    });
  });
});
