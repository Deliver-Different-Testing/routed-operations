import fs from 'fs';
const data = JSON.parse(fs.readFileSync('coverage/coverage-summary.json', 'utf-8'));
const files = Object.entries(data).filter(([k]) => k !== 'total').map(([path, info]) => {
  const short = path.replace(/^.*wwwroot[/\\]app[/\\]react[/\\]/, '').replace(/\\/g, '/');
  return {
    path: short,
    pct: info.lines.pct,
    total: info.lines.total,
    covered: info.lines.covered,
  };
});
files.sort((a, b) => (a.pct - b.pct) || (b.total - a.total));
console.log('%Lines\tStmts\tPath');
files.filter(f => f.pct < 25 && f.total >= 30).slice(0, 50).forEach(f => {
  console.log(f.pct.toFixed(1) + '%\t' + f.total + '\t' + f.path);
});
