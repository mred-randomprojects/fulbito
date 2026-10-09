import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  loadAppData,
  saveAppData,
  STORAGE_KEY,
  StorageQuotaError,
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
