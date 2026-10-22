from pathlib import Path
import sqlite3
connection=sqlite3.connect(':memory:')
for file in sorted(Path('services/api/migrations').glob('*.sql')):
    connection.executescript(file.read_text())
assert connection.execute('PRAGMA foreign_key_check').fetchall()==[]
assert connection.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
for name in ['users','refresh_sessions','matches','messages','consumable_ledger','moderation_cases','admin_audit_logs']:
    assert connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?",(name,)).fetchone()
print('Schema migrations passed: integrity, foreign keys, required tables.')
