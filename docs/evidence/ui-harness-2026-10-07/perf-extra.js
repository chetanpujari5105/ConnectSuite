async (id) => {
  // Route, let the synthetic bridge's promises settle, force style+layout; repeat 5 times, report median.
  const runs = [];
  for (let i = 0; i < 5; i++) {
    shell.route('overview'); await new Promise((r) => setTimeout(r, 50));
    const t0 = performance.now();
    shell.route(id);
    for (let k = 0; k < 3; k++) await new Promise((r) => setTimeout(r, 0));
    void document.body.offsetHeight;
    runs.push(performance.now() - t0);
  }
  runs.sort((a, b) => a - b);
  return { medianMs: Math.round(runs[2] * 10) / 10, minMs: Math.round(runs[0] * 10) / 10, maxMs: Math.round(runs[4] * 10) / 10, nodes: document.getElementsByTagName('*').length };
}
