// The application keeps parameterized SQL; this small translation covers its
// existing SQLite upserts without coupling business rules to a hosting vendor.
export function mysqlSql(sql) {
 return sql.replace(/(?<!`)\buntil\b(?!`)/g,'`until`')
  .replace(/INSERT OR IGNORE INTO badges VALUES\(\?,\?,\?\)/g,'INSERT INTO badges VALUES(?,?,?) ON DUPLICATE KEY UPDATE badge=VALUES(badge)')
  .replace(/ON CONFLICT\(\w+\) DO UPDATE SET/g,'ON DUPLICATE KEY UPDATE')
  .replace(/excluded\.(\w+|`until`)/g,(_,column)=>'VALUES('+column+')');
}
