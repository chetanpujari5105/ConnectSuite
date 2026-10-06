(id) => {
  const rows = [...document.querySelectorAll('[data-nav]')];
  const last = rows[rows.length - 1];
  const acct = document.querySelector('.sidebar-account, .account, #account, .sidebar-foot, .sidebar-footer');
  const nav = last && last.parentElement;
  let scroller = null;
  for (let a = last; a; a = a.parentElement) { const oy = getComputedStyle(a).overflowY; if (oy === 'auto' || oy === 'scroll') { scroller = a; break; } }
  const hit = last ? document.elementFromPoint(last.getBoundingClientRect().left + 20, last.getBoundingClientRect().top + last.getBoundingClientRect().height / 2) : null;
  return {
    rows: rows.length, last: last && last.getAttribute('data-nav'), lastRect: last && last.getBoundingClientRect().toJSON(),
    account: acct && { cls: acct.className, rect: acct.getBoundingClientRect().toJSON() },
    scroller: scroller && { cls: scroller.className, sh: scroller.scrollHeight, ch: scroller.clientHeight },
    hitIsLastRow: !!(hit && last && last.contains(hit)), hitDesc: hit && (hit.className || hit.tagName), innerHeight,
  };
}
