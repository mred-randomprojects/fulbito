import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatBytes,
  isFulbitoKey,
  isQuotaError,
  loadAppData,
  quotaMessage,
  saveAppData,
  STORAGE_KEY,
  StorageQuotaError,
  storageChange,
  storageUsage,
  type AppDataStorage,
} from "./storage.js";
import { normalizeAppData, type AppData } from "./types.js";

const BACKUP_KEY = "fulbito-data-backup";
const CORRUPT_RECOVERY_KEY = "fulbito-data-corrupt-recovery";

/**
 * A localStorage made of a Map. With a `quota`, a write that would take the
 * total past it throws the browser's own error, the way a full origin does.
 */
function fakeStorage(initial: Record<string, string> = {}, quota = Infinity) {
  const values = new Map(Object.entries(initial));
  const size = () => [...values].reduce((sum, [k, v]) => sum + k.length + v.length, 0);
  const storage: AppDataStorage = {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      const without = size() - (values.has(key) ? key.length + (values.get(key)?.length ?? 0) : 0);
      if (without + key.length + value.length > quota) {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      }
      values.set(key, value);
    },
  };
  return { storage, values };
}

function blob(...names: string[]): AppData {
  return normalizeAppData({
    players: names.map((name) => ({ id: name.toLowerCase(), firstName: name, rating: 50, ratingScale: 100 })),
  });
}

const names = (data: AppData) => data.players.map((player) => player.firstName);

/** What a write cut off half way leaves behind. */
const CORRUPT = '{"players":[{"id":"gordo","firstName":"Go';

describe("loading the stored data", () => {
  it("falls back to the backup when the primary does not parse, and stashes the primary", () => {
    const { storage, values } = fakeStorage({
      [STORAGE_KEY]: CORRUPT,
      [BACKUP_KEY]: JSON.stringify(blob("Gordo", "Colo")),
    });

    assert.deepEqual(names(loadAppData(storage)), ["Gordo", "Colo"]);
    assert.equal(values.get(CORRUPT_RECOVERY_KEY), CORRUPT);
  });

  it("starts empty only when neither copy parses", () => {
    const { storage } = fakeStorage({ [STORAGE_KEY]: CORRUPT, [BACKUP_KEY]: CORRUPT });
    assert.deepEqual(loadAppData(storage).players, []);
  });
});

/**
 * The primary gone while the backup is still there: devtools, a storage
 * cleaner, a sibling app's tidy-up. Loading used to start empty, and the
 * second save then rolled that empty primary over the only good copy.
 */
describe("a primary that is not there at all", () => {
  it("loads the backup, and the next saves keep it", () => {
    const { storage, values } = fakeStorage({ [BACKUP_KEY]: JSON.stringify(blob("Gordo", "Colo")) });
    const loaded = loadAppData(storage);
    assert.deepEqual(names(loaded), ["Gordo", "Colo"]);
    saveAppData(loaded, storage);
    saveAppData(loaded, storage);
    assert.deepEqual(names(loadAppData(storage)), ["Gordo", "Colo"]);
    assert.deepEqual(names(normalizeAppData(JSON.parse(values.get(BACKUP_KEY) ?? "{}"))), ["Gordo", "Colo"]);
  });

  it("starts empty on a first visit, and with a backup that is not the app's data", () => {
    assert.deepEqual(names(loadAppData(fakeStorage().storage)), []);
    assert.deepEqual(names(loadAppData(fakeStorage({ [BACKUP_KEY]: CORRUPT }).storage)), []);
    assert.deepEqual(names(loadAppData(fakeStorage({ [BACKUP_KEY]: "[1,2]" }).storage)), []);
  });
});

describe("what another tab's write means for this one", () => {
  it("writes this tab's copy back when the data is taken out from under it", () => {
    assert.deepEqual(storageChange({ key: null, newValue: null }), { kind: "rewrite" });
    assert.deepEqual(storageChange({ key: STORAGE_KEY, newValue: null }), { kind: "rewrite" });
  });

  it("merges what the other tab wrote, read off the event", () => {
    const change = storageChange({ key: STORAGE_KEY, newValue: JSON.stringify(blob("Pato")) });
    assert.equal(change.kind, "merge");
    assert.deepEqual(change.kind === "merge" ? names(change.data) : [], ["Pato"]);
  });

  it("ignores everybody else's keys, and a write it cannot read", () => {
    assert.deepEqual(storageChange({ key: "nutriapp-data", newValue: null }), { kind: "ignore" });
    assert.deepEqual(storageChange({ key: BACKUP_KEY, newValue: null }), { kind: "ignore" });
    assert.deepEqual(storageChange({ key: STORAGE_KEY, newValue: CORRUPT }), { kind: "ignore" });
  });
});

describe("saving", () => {
  it("rolls a good previous copy into the backup before writing", () => {
    const { storage, values } = fakeStorage({ [STORAGE_KEY]: JSON.stringify(blob("Gordo")) });

    saveAppData(blob("Gordo", "Colo"), storage);

    assert.deepEqual(names(normalizeAppData(JSON.parse(values.get(BACKUP_KEY) ?? ""))), ["Gordo"]);
    assert.deepEqual(names(loadAppData(storage)), ["Gordo", "Colo"]);
  });

  it("never rolls a corrupt primary over the only good backup", () => {
    const good = JSON.stringify(blob("Gordo", "Colo"));
    const { storage, values } = fakeStorage({ [STORAGE_KEY]: CORRUPT, [BACKUP_KEY]: good });

    const recovered = loadAppData(storage);
    saveAppData({ ...recovered, players: recovered.players.slice(0, 1) }, storage);

    assert.equal(values.get(BACKUP_KEY), good);
    assert.deepEqual(names(loadAppData(storage)), ["Gordo"]);
  });

  it("does not keep a blob that parses but is not the app's data as the backup", () => {
    for (const notData of ["null", "[]", "42", '"text"']) {
      const good = JSON.stringify(blob("Gordo"));
      const { storage, values } = fakeStorage({ [STORAGE_KEY]: notData, [BACKUP_KEY]: good });

      saveAppData(blob("Colo"), storage);

      assert.equal(values.get(BACKUP_KEY), good, notData);
    }
  });

  it("names a full origin as StorageQuotaError", () => {
    const { storage } = fakeStorage({}, 10);
    assert.throws(() => saveAppData(blob("Gordo"), storage), StorageQuotaError);
  });

  it("rethrows any other storage failure as it came", () => {
    const storage: AppDataStorage = {
      length: 0,
      key: () => null,
      getItem: () => null,
      setItem: () => {
        throw new DOMException("Storage is disabled.", "SecurityError");
      },
    };
    assert.throws(
      () => saveAppData(blob("Gordo"), storage),
      (e: unknown) => e instanceof DOMException && e.name === "SecurityError",
    );
  });

  it("still reloads the backup after a corrupt primary and a full origin", () => {
    // The double fault: the primary is corrupt, and the origin is so full that
    // the first save after recovering cannot write the primary either.
    const good = JSON.stringify(blob("Gordo", "Colo", "Pato"));
    const initial = { [STORAGE_KEY]: CORRUPT, [BACKUP_KEY]: good };
    const tight = Object.entries(initial).reduce((sum, [k, v]) => sum + k.length + v.length, 0);
    const { storage, values } = fakeStorage(initial, tight + CORRUPT_RECOVERY_KEY.length + CORRUPT.length);

    const recovered = loadAppData(storage);
    assert.deepEqual(names(recovered), ["Gordo", "Colo", "Pato"]);
    assert.throws(
      () => saveAppData({ ...recovered, players: [...recovered.players, ...blob("Tano").players] }, storage),
      StorageQuotaError,
    );

    assert.equal(values.get(BACKUP_KEY), good);
    assert.deepEqual(names(loadAppData(storage)), ["Gordo", "Colo", "Pato"]);
  });
});

describe("the space fulbito shares with every app on the site", () => {
  it("counts fulbito's keys apart from everybody else's, in UTF-16 bytes", () => {
    const { storage } = fakeStorage({
      "fulbito-data": "x".repeat(100),
      "fulbito-hide-scores": "1",
      "nutriapp-data": "y".repeat(300),
      ph_abc_posthog: "{}",
    });

    assert.deepEqual(storageUsage(isFulbitoKey, storage), {
      mine: ("fulbito-data".length + 100 + "fulbito-hide-scores".length + 1) * 2,
      others: ("nutriapp-data".length + 300 + "ph_abc_posthog".length + 2) * 2,
    });
  });

  it("reads nothing, and says nothing, when the storage refuses", () => {
    const storage: AppDataStorage = {
      get length(): number {
        throw new DOMException("Storage is disabled.", "SecurityError");
      },
      key: () => null,
      getItem: () => null,
      setItem: () => {},
    };
    assert.deepEqual(storageUsage(isFulbitoKey, storage), { mine: 0, others: 0 });
  });

  it("only owns keys that start with fulbito-", () => {
    assert.equal(isFulbitoKey("fulbito-data"), true);
    assert.equal(isFulbitoKey("fulbito-split-draft-v1"), true);
    assert.equal(isFulbitoKey("fulbito"), false);
    assert.equal(isFulbitoKey("nutriapp-data"), false);
    assert.equal(isFulbitoKey("ph_phc_x_posthog"), false);
  });

  it("writes an amount in KB below a megabyte and in MB with a comma above", () => {
    assert.equal(formatBytes(0), "0 KB");
    assert.equal(formatBytes(1536), "2 KB");
    assert.equal(formatBytes(1.5 * 1024 * 1024), "1,5 MB");
  });

  it("tells a quota error apart from any other failure", () => {
    assert.equal(isQuotaError(new DOMException("full", "QuotaExceededError")), true);
    assert.equal(isQuotaError(new DOMException("full", "NS_ERROR_DOM_QUOTA_REACHED")), true);
    assert.equal(isQuotaError(new DOMException("no", "SecurityError")), false);
    assert.equal(isQuotaError(new Error("QuotaExceededError")), false);
  });
});

describe("what a full browser says", () => {
  const MB = 1024 * 1024;

  it("suggests clearing fulbito's own photos and matches when fulbito holds the most", () => {
    const message = quotaMessage({ mine: 3 * MB, others: 2 * MB });
    assert.match(message, /esta usa 3,0 MB, las demás 2,0 MB/);
    assert.match(message, /Borrá algunas fotos o partidos viejos/);
  });

  it("does not, when the other apps hold the most", () => {
    const message = quotaMessage({ mine: 400 * 1024, others: 4.5 * MB });
    assert.match(message, /esta usa 400 KB, las demás 4,5 MB/);
    assert.doesNotMatch(message, /Borrá|arrancá de nuevo/);
    assert.match(message, /otras apps/);
    assert.match(message, /bajate el backup/);
  });

  it("is what a save that does not fit throws, measured on the storage that refused it", () => {
    const sibling = "z".repeat(2000);
    const { storage } = fakeStorage({ "dineros-data": sibling }, "dineros-data".length + sibling.length + 50);

    assert.throws(
      () => saveAppData(blob("Gordo", "Colo"), storage),
      (e: unknown) =>
        e instanceof StorageQuotaError &&
        e.message.includes("las demás 4 KB") &&
        !e.message.includes("Borrá"),
    );
  });
});
