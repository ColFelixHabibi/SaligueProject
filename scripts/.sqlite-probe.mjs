import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(':memory:');
db.exec('create table t(a text, b integer, c, d json)');
db.prepare('insert into t(a,b,c,d) values (?,?,?,?)').run('see /media/abc.jpg here', 1, null, '{"caption":"/media/zz.vtt"}');
console.log('columns via pragma_table_info(?)', JSON.stringify(db.prepare('select name, type from pragma_table_info(?)').all('t')));
console.log('columns via pragma table_info', JSON.stringify(db.prepare('pragma table_info("t")').all()));
console.log('hit', JSON.stringify(db.prepare("select 1 as hit from t where instr(a, ?) > 0 limit 1").get('/media/abc.jpg')));
console.log('miss', JSON.stringify(db.prepare("select 1 as hit from t where instr(a, ?) > 0 limit 1").get('/media/nope.jpg')));
console.log('json column', JSON.stringify(db.prepare("select d as value from t where instr(d, '/media/') > 0").all()));
