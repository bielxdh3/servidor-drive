const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rootark-user-generation-"));
process.env.DATABASE_URL = path.join(directory, "rootark.sqlite");

const { closeDb } = require("../db");
const { runMigrations } = require("../db/migrations");
const usersRepository = require("../repositories/usersRepository");

test("SQLite increments a deleted username generation on every recreation", (t) => {
  t.after(() => {
    closeDb();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  runMigrations({ backup: false });

  const agent = { username: "agent", password: "disposable", role: "user", permissions: {}, sessionVersion: 0 };
  usersRepository.saveUsers([agent]);
  usersRepository.saveUsers([]);
  usersRepository.saveUsers([agent]);
  assert.equal(usersRepository.loadUsers()[0].sessionVersion, 1);

  usersRepository.saveUsers([]);
  usersRepository.saveUsers([agent]);
  assert.equal(usersRepository.loadUsers()[0].sessionVersion, 2);
});
