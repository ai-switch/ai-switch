import { describe, expect, it } from "vitest";
import {
  ACCOUNT_DISPLAY_PREFERENCES_STORAGE_KEY,
  DEFAULT_ACCOUNT_DISPLAY_PREFERENCES,
  loadAccountDisplayPreferences,
  saveAccountDisplayPreferences,
} from "../../src/lib/accountDisplayPreferences";

describe("account display preferences", () => {
  it("uses the requested defaults when no preference has been saved", () => {
    const storage = { getItem: () => null };
    expect(loadAccountDisplayPreferences(storage)).toEqual({
      showProvider: false,
      showAccountType: false,
      showModelList: true,
      showRequestStats: true,
      showLatencyStats: false,
      showResetTime: true,
      showRelayGroupName: false,
    });
    expect(DEFAULT_ACCOUNT_DISPLAY_PREFERENCES).toEqual({
      showProvider: false,
      showAccountType: false,
      showModelList: true,
      showRequestStats: true,
      showLatencyStats: false,
      showResetTime: true,
      showRelayGroupName: false,
    });
  });

  it("loads valid saved preferences and ignores malformed values", () => {
    const storage = {
      getItem: (key: string) => key === ACCOUNT_DISPLAY_PREFERENCES_STORAGE_KEY
        ? '{"showAccountType":true,"showModelList":false,"showRequestStats":true}'
        : null,
    };
    expect(loadAccountDisplayPreferences(storage)).toEqual({
      showProvider: false,
      showAccountType: true,
      showModelList: false,
      showRequestStats: true,
      showLatencyStats: false,
      showResetTime: true,
      showRelayGroupName: false,
    });
    expect(loadAccountDisplayPreferences({ getItem: () => "not-json" })).toEqual(
      DEFAULT_ACCOUNT_DISPLAY_PREFERENCES,
    );
  });

  it("persists the selected display preferences", () => {
    let saved = "";
    saveAccountDisplayPreferences(
      { showProvider: true, showAccountType: true, showModelList: false, showRequestStats: false, showLatencyStats: true, showResetTime: true, showRelayGroupName: true },
      { setItem: (_key, value) => { saved = value; } },
    );
    expect(JSON.parse(saved)).toEqual({
      showProvider: true,
      showAccountType: true,
      showModelList: false,
      showRequestStats: false,
      showLatencyStats: true,
      showResetTime: true,
      showRelayGroupName: true,
    });
  });

  it("keeps the toggles a stored record does carry when one is missing", () => {
    // The next toggle added here ships with every existing user's record lacking
    // it. An all-or-nothing check would reset all of their choices on upgrade,
    // so each field has to fall back on its own.
    const storage = { getItem: () => '{"showAccountType":true,"showModelList":false}' };
    expect(loadAccountDisplayPreferences(storage)).toEqual({
      showProvider: false,
      showAccountType: true,
      showModelList: false,
      // Only the absent ones fall back.
      showRequestStats: true,
      showLatencyStats: false,
      showResetTime: true,
      showRelayGroupName: false,
    });
  });

  it("falls back per field for wrong types and drops unknown keys", () => {
    const storage = {
      getItem: () =>
        '{"showAccountType":"yes","showModelList":false,"showRequestStats":1,"showLatencyStats":"maybe","stale":true}',
    };
    const loaded = loadAccountDisplayPreferences(storage);
    expect(loaded).toEqual({
      showProvider: false,
      showAccountType: false,
      showModelList: false,
      showRequestStats: true,
      showLatencyStats: false,
      showResetTime: true,
      showRelayGroupName: false,
    });
    // A key from a removed toggle must not be written back on the next save.
    expect(Object.keys(loaded)).not.toContain("stale");
  });

  it("reads a non-object payload as no preference rather than throwing", () => {
    for (const raw of ["null", "[]", '"showModelList"', "42"]) {
      expect(loadAccountDisplayPreferences({ getItem: () => raw })).toEqual(
        DEFAULT_ACCOUNT_DISPLAY_PREFERENCES,
      );
    }
  });

  it("survives a storage accessor that throws", () => {
    // Site data blocked, or a sandboxed iframe: touching localStorage raises
    // SecurityError. This runs in a useState initializer, so an escape is a blank
    // screen rather than a caught error.
    const storage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(loadAccountDisplayPreferences(storage)).toEqual(
      DEFAULT_ACCOUNT_DISPLAY_PREFERENCES,
    );
    expect(() =>
      saveAccountDisplayPreferences(DEFAULT_ACCOUNT_DISPLAY_PREFERENCES, {
        setItem: () => {
          throw new Error("SecurityError");
        },
      }),
    ).not.toThrow();
  });
});
