import sys, json, os
from playwright.sync_api import sync_playwright

BASE = "file:///home/claude/simplytax/backend/eric/"

# Device matrix spanning ~a decade of real phones/tablets (CSS px).
# 280: folded foldables; 320: iPhone 5/SE1; 360: most common Android;
# 375: iPhone 6/7/8/X; 390-393: iPhone 12-16; 412: Pixel/Galaxy; 430: Pro Max; 768: tablet
PORTRAIT = [(280,653,3),(320,568,2),(360,640,3),(360,800,3),(375,667,2),(390,844,3),(412,915,2.6),(430,932,3),(768,1024,2),(834,1194,2)]
LANDSCAPE = [(568,320,2),(667,375,2),(844,390,3),(915,412,2.6),(1024,768,2)]

MOBILE_UA = "Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36"

MEASURE_JS = r"""
() => {
  const vw = document.documentElement.clientWidth;
  const out = {vw, scrollW: document.documentElement.scrollWidth, bodyScrollW: document.body.scrollWidth,
               overflowers: [], small_targets: [], small_inputs: [], tiny_text: {}, issues: []};
  const sel = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    else if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\s+/).slice(0,2).join('.');
    return s;
  };
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const clippedByScrollAncestor = (el) => {
    let p = el.parentElement;
    while (p && p !== document.body) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(cs.overflowX)) {
        const pr = p.getBoundingClientRect();
        if (pr.right <= vw + 1 && pr.left >= -1) return true;
      }
      p = p.parentElement;
    }
    return false;
  };
  // 1. overflow offenders
  const all = [...document.body.querySelectorAll('*')];
  for (const el of all) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' && el.closest('.modal-bg')) {}
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) {
      if (clippedByScrollAncestor(el)) continue;
      out.overflowers.push({el: sel(el), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width)});
    }
  }
  // text-level overflow: a long word can spill past the viewport without its box moving
  {
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let tn;
    while ((tn = tw.nextNode())) {
      if (!tn.textContent.trim()) continue;
      const pe = tn.parentElement;
      if (!pe || ['SCRIPT','STYLE','NOSCRIPT'].includes(pe.tagName) || !visible(pe)) continue;
      if (clippedByScrollAncestor(pe)) continue;
      { const pcs = getComputedStyle(pe), prr = pe.getBoundingClientRect();   // text clipped by its OWN box (e.g. ellipsis)
        if (/(hidden|clip|auto|scroll)/.test(pcs.overflowX) && prr.right <= vw + 1 && prr.left >= -1) continue; }
      const rg = document.createRange(); rg.selectNodeContents(tn);
      for (const rc of rg.getClientRects()) {
        if (rc.right > vw + 1 && rc.width > 0) {
          out.overflowers.push({el: 'TEXT "' + tn.textContent.trim().slice(0,28) + '" in ' + sel(pe), left: Math.round(rc.left), right: Math.round(rc.right), w: Math.round(rc.width)});
          break;
        }
      }
    }
  }
  out.overflowers = out.overflowers.slice(0, 12);
  // 2. tap targets
  const tsel = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [onclick]';
  const seen = new Set();
  for (const el of document.querySelectorAll(tsel)) {
    if (!visible(el)) continue;
    let target = el;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if ((type === 'checkbox' || type === 'radio') ) {
      const lab = el.closest('label');
      if (lab) target = lab;
    }
    if (target.tagName === 'A') {
      // WCAG 2.5.8 inline exception: link inside a sentence of body text
      const cs = getComputedStyle(target);
      const par = target.parentElement;
      if (cs.display === 'inline' && par) {
        const ptxt = (par.textContent || '').trim().length;
        const ltxt = (target.textContent || '').trim().length;
        if (ptxt > ltxt + 12) continue;
      }
    }
    if (seen.has(target)) continue; seen.add(target);
    const r = target.getBoundingClientRect();
    const minDim = Math.min(r.width, r.height);
    if (minDim < 44) {
      out.small_targets.push({el: sel(target), w: Math.round(r.width), h: Math.round(r.height),
        text: (target.textContent || target.value || target.getAttribute('aria-label') || '').trim().slice(0,28),
        level: (r.width < 24 || r.height < 24) ? 'FAIL<24' : 'warn<44'});
    }
  }
  // 3. input font-size (iOS Safari zooms if < 16px)
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (!visible(el)) continue;
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (['checkbox','radio','file','range','color','button','submit','reset','image'].includes(type)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 16) out.small_inputs.push({el: sel(el), fs});
  }
  // 4. tiny text
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const t = n.textContent.trim();
    if (t.length < 2) continue;
    const el = n.parentElement;
    if (!el || ['SCRIPT','STYLE','NOSCRIPT'].includes(el.tagName)) continue;
    if (!visible(el)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 11) {
      const k = sel(el) + ' @' + fs + 'px';
      out.tiny_text[k] = (out.tiny_text[k] || 0) + 1;
    }
  }
  // 5. viewport meta
  const vm = document.querySelector('meta[name=viewport]');
  out.viewport_meta = vm ? vm.getAttribute('content') : null;
  if (!vm) out.issues.push('NO viewport meta');
  else {
    const c = vm.getAttribute('content');
    if (/user-scalable\s*=\s*(no|0)/i.test(c)) out.issues.push('viewport blocks zoom (user-scalable=no)');
    if (/maximum-scale\s*=\s*1(\.0)?\b/i.test(c)) out.issues.push('viewport blocks zoom (maximum-scale=1)');
  }
  return out;
}
"""

def dedupe(items, keyf):
    seen = {}
    for it in items:
        k = keyf(it)
        if k not in seen:
            seen[k] = dict(it, count=1)
        else:
            seen[k]['count'] += 1
    return list(seen.values())

def run(states, viewports, label):
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for (w, h, dpr) in viewports:
            ctx = browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=dpr,
                                      is_mobile=True, has_touch=True, user_agent=MOBILE_UA)
            for name, url, setup in states:
                page = ctx.new_page()
                page.on("pageerror", lambda e: None)
                try:
                    page.goto(BASE + url, wait_until="load")
                    page.wait_for_timeout(250)
                    if setup:
                        page.evaluate(setup)
                        page.wait_for_timeout(250)
                        # expose collapsed content too
                        page.evaluate("document.querySelectorAll('details').forEach(d=>d.open=true)")
                        page.wait_for_timeout(120)
                    m = page.evaluate(MEASURE_JS)
                    m['state'] = name; m['viewport'] = f'{w}x{h}'
                    results.append(m)
                except Exception as e:
                    results.append({'state': name, 'viewport': f'{w}x{h}', 'error': str(e)[:160]})
                page.close()
            ctx.close()
        browser.close()
    return results

def summarize(results):
    lines = []
    for r in results:
        if 'error' in r:
            lines.append(f"[{r['viewport']:>8}] {r['state']}: ERROR {r['error']}")
            continue
        probs = []
        if r['scrollW'] > r['vw'] + 1:
            probs.append(f"H-SCROLL (doc {r['scrollW']} > vw {r['vw']})")
        if r['overflowers']:
            top = dedupe(r['overflowers'], lambda o: o['el'])[:3]
            probs.append("overflow: " + "; ".join(f"{o['el']} r={o['right']}" for o in top))
        fails = [t for t in r['small_targets'] if t['level'] == 'FAIL<24']
        if fails:
            top = dedupe(fails, lambda t: t['el'])[:3]
            probs.append("TAP<24: " + "; ".join(f"{t['el']}({t['w']}x{t['h']})" for t in top))
        if r['small_inputs']:
            top = dedupe(r['small_inputs'], lambda t: t['el'])[:2]
            probs.append("INPUT<16px: " + "; ".join(f"{t['el']}={t['fs']}" for t in top))
        if r['tiny_text']:
            probs.append("TEXT<12px: " + "; ".join(f"{k}x{v}" for k, v in list(r['tiny_text'].items())[:2]))
        for i in r['issues']:
            probs.append(i)
        warn = len([t for t in r['small_targets'] if t['level'] == 'warn<44'])
        status = 'OK ' if not probs else 'BAD'
        lines.append(f"{status} [{r['viewport']:>8}] {r['state']}" + (f"  (+{warn} tap<44)" if warn else "") + ("  -> " + " | ".join(probs) if probs else ""))
    return "\n".join(lines)

STATIC_PAGES = ['home.html', 'agb.html', 'datenschutz.html', 'impressum.html', 'program-scope.html',
                'elster-zertifikat-guide.html', 'steuerwissen.html']

if __name__ == '__main__':
    group = sys.argv[1]
    mode = sys.argv[2] if len(sys.argv) > 2 else 'portrait'
    if mode.startswith('only:'):
        want = set(int(x) for x in mode[5:].split(','))
        vps = [v for v in PORTRAIT + LANDSCAPE if v[0] in want]
    else:
        vps = PORTRAIT if mode == 'portrait' else LANDSCAPE if mode == 'landscape' else PORTRAIT + LANDSCAPE
    if group == 'static':
        states = []
        for pg in STATIC_PAGES:
            states.append((pg + ' [default lang]', pg, None))
            states.append((pg + ' [toggled lang]', pg, "toggleLang()"))
        res = run(states, vps, group)
    else:
        mod = __import__('app_states')
        states = getattr(mod, group)
        res = run(states, vps, group)
    json.dump(res, open(f'/tmp/audit_{group}_{mode.replace(":","_").replace(",","-")}.json', 'w'))
    print(summarize(res))
