const SUFFIX = ".cloudmatchbeta.nvidiagrid.net";
const BASE = {
  "US Central": ["DAL-02","DAL-03","DAL-04u","DAL-05u"],
  "US East": ["ASH-03","ASH-04u"],
  "US Midwest": ["CHI-03","CHI-04u","CHI-05u"],
  "US Northeast": ["NWK-02","NWK-03u"],
  "US Northwest": ["PDX-01u","PDX-02"],
  "US South": ["ATL-02","ATL-03u","ATL-04u"],
  "US Southeast": ["MIA-02","MIA-03u"],
  "US Southwest": ["LAX-02","LAX-03u"],
  "US Mountain": ["PHX-01","PHX-02u"],
  "US West": ["SJC6-02","SJC6-04u","SJC6-06u"],
  "CA East": ["MON-01","MON-02u"],
  "EU Northeast": ["AMS-02","AMS-03","AMS-04","AMS-05u","AMS-06u","AMS-07u","AMS-08u"],
  "EU Central": ["FRK-04","FRK-05","FRK-06u","FRK-07u","FRK-08u"],
  "EU Southwest": ["PAR-02","PAR-03","PAR-04u","PAR-05u","PAR-06u","PAR-07u"],
  "EU West": ["LON-03","LON-04","LON-05u","LON-06u","LON-07u"],
  "EU Northwest": ["STH-02","STH-03u"],
  "Japan": ["TYO-01v"],
  "India": ["BOM-01v"]
};

const $ = id => document.getElementById(id);
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} };

let custom = load("gfn_custom", []);
let servers = [];
let sort = { k: "avg", dir: 1 };
let running = false, abort = false;

function buildServers() {
  servers = [];
  for (const [region, list] of Object.entries(BASE))
    for (const z of list) {
      const f = z.slice(-1), tier = f === "u" ? "4080" : f === "v" ? "5080" : "std";
      const id = "NP-" + (tier === "std" ? z : z.slice(0, -1));
      servers.push({ name: id, host: id.toLowerCase() + SUFFIX, region, gpu: tier, custom: false, res: null });
    }
  for (const c of custom)
    servers.push({ name: c.name, host: c.host, region: c.region || "Tùy chỉnh", gpu: "std", custom: true, res: null });
  const old = $("regionSel").value || "all";
  const regions = [...new Set(servers.map(s => s.region))];
  $("regionSel").innerHTML = '<option value="all">Tất cả khu vực</option>' + regions.map(r => `<option>${r}</option>`).join("");
  $("regionSel").value = regions.includes(old) ? old : "all";
}

async function once(host, timeout) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  const t0 = performance.now();
  try {
    await fetch(`https://${host}/v2/serverInfo?_=${Math.random().toString(36).slice(2)}`, {
      mode: "no-cors",
      cache: "no-store",
      signal: ctl.signal
    });
    return performance.now() - t0;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function testServer(s, n, timeout) {
  s.state = "running";
  render();
  await once(s.host, timeout); // warm-up
  const ok = [];
  let fail = 0;
  for (let i = 0; i < n && !abort; i++) {
    const v = await once(s.host, timeout);
    v === null ? fail++ : ok.push(v);
  }
  if (abort) { s.state = null; return; }
  if (!ok.length) {
    s.res = { dead: true, loss: 100 };
  } else {
    const avg = ok.reduce((a, b) => a + b, 0) / ok.length;
    const jit = ok.length > 1 ? ok.slice(1).reduce((a, v, i) => a + Math.abs(v - ok[i]), 0) / (ok.length - 1) : 0;
    s.res = { avg, min: Math.min(...ok), jitter: jit, loss: fail / n * 100 };
  }
  s.state = "done";
}

async function run() {
  if (running) { abort = true; return; }
  running = true;
  abort = false;
  const n = +$("samples").value, timeout = +$("timeout").value, conc = +$("conc").value;
  servers.forEach(s => { s.res = null; s.state = null; });
  const queue = servers.filter(visible);
  const total = queue.length;
  let done = 0;
  $("runBtn").textContent = "Dừng kiểm tra";
  $("runBtn").classList.add("stop");
  const worker = async () => {
    while (queue.length && !abort) {
      const s = queue.shift();
      await testServer(s, n, timeout);
      done++;
      $("prog").style.width = (done / total * 100) + "%";
      render();
    }
  };
  await Promise.all(Array.from({ length: conc }, worker));
  running = false;
  abort = false;
  $("runBtn").textContent = "Kiểm tra lại";
  $("runBtn").classList.remove("stop");
  setTimeout(() => $("prog").style.width = "0", 800);
  render();
}

function visible(s) {
  const q = $("search").value.trim().toLowerCase();
  if ($("regionSel").value !== "all" && s.region !== $("regionSel").value) return false;
  if ($("gpuSel").value !== "all" && s.gpu !== $("gpuSel").value) return false;
  return !q || (s.name + " " + s.region).toLowerCase().includes(q);
}

const cls = v => v < 40 ? "g" : v < 80 ? "o" : "r";
const col = v => v < 40 ? "var(--good)" : v < 80 ? "var(--ok)" : "var(--bad)";
const val = (s, k) => {
  if (k === "name" || k === "region") return s[k];
  const r = s.res;
  if (!r || r.dead) return Infinity;
  return r[k];
};

function render() {
  const list = servers.filter(visible).sort((a, b) => {
    const x = val(a, sort.k), y = val(b, sort.k);
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
  });
  $("rows").innerHTML = list.length ? list.map(s => {
    const r = s.res;
    let ping, best = "—", jit = "—", loss = "—", bar = "";
    if (s.state === "running") {
      ping = '<span class="pill n"><span class="spin">⟳</span></span>';
    } else if (!r) {
      ping = '<span class="pill n">—</span>';
    } else if (r.dead) {
      ping = '<span class="pill r">Không kết nối</span>';
      loss = "100%";
    } else {
      ping = `<span class="pill ${cls(r.avg)}">${r.avg.toFixed(0)} ms</span>`;
      best = r.min.toFixed(0) + " ms";
      jit = r.jitter.toFixed(1) + " ms";
      loss = r.loss.toFixed(0) + "%";
      bar = `<span class="bar"><i style="width:${Math.max(6, 100 - Math.min(r.avg, 150) / 150 * 100)}%;background:${col(r.avg)}"></i></span>`;
    }
    const tags = (s.gpu === "4080" ? '<span class="tag">RTX 4080</span>' : s.gpu === "5080" ? '<span class="tag">RTX 5080</span>' : "") +
                 (s.custom ? '<span class="tag c">Tùy chỉnh</span>' : "");
    const rm = s.custom ? `<button class="rm" title="Xóa" aria-label="Xóa ${s.name}" data-rm="${s.host}">×</button>` : "";
    return `<tr>
      <td class="name">${s.name}${tags}</td>
      <td class="region">${s.region}</td>
      <td class="num">${ping}</td>
      <td class="num">${best}</td>
      <td class="num">${jit}</td>
      <td class="num">${loss}</td>
      <td>${bar}</td>
      <td>${rm}</td>
    </tr>`;
  }).join("") : '<tr><td colspan="8" class="empty">Không có server nào khớp bộ lọc.</td></tr>';
  summary();
}

function summary() {
  const vis = servers.filter(visible);
  const done = vis.filter(s => s.res);
  const ok = done.filter(s => !s.res.dead);
  $("testedV").textContent = `${done.length} / ${vis.length}`;
  const bad = done.length - ok.length;
  $("failedS").innerHTML = bad ? `${bad} không kết nối được` : "&nbsp;";
  $("avgV").textContent = ok.length ? Math.round(ok.reduce((a, s) => a + s.res.avg, 0) / ok.length) + " ms" : "—";
  $("goodV").textContent = ok.filter(s => s.res.avg < 40).length;
  if (ok.length) {
    const b = ok.reduce((a, s) => s.res.avg < a.res.avg ? s : a);
    $("bestName").textContent = b.name;
    $("bestSub").textContent = `${b.res.avg.toFixed(0)} ms • ${b.region}`;
  } else {
    $("bestName").textContent = "—";
    $("bestSub").textContent = "Chạy kiểm tra để xem kết quả";
  }
}

document.querySelectorAll("th[data-k]").forEach(th => th.addEventListener("click", () => {
  const k = th.dataset.k;
  sort = { k, dir: sort.k === k ? -sort.dir : 1 };
  render();
}));

["search", "regionSel", "gpuSel"].forEach(id => $(id).addEventListener("input", render));
$("runBtn").addEventListener("click", run);

$("addBtn").addEventListener("click", () => {
  let v = $("cName").value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!v) return;
  const host = v.includes(".") ? v : v + SUFFIX;
  if (servers.some(s => s.host === host)) { $("cName").value = ""; return; }
  custom.push({
    name: v.includes(".") ? v.split(".")[0].toUpperCase() : v.toUpperCase(),
    host,
    region: $("cRegion").value.trim()
  });
  save("gfn_custom", custom);
  $("cName").value = "";
  $("cRegion").value = "";
  buildServers();
  render();
});

$("rows").addEventListener("click", e => {
  const h = e.target.dataset.rm;
  if (!h) return;
  custom = custom.filter(c => c.host !== h);
  save("gfn_custom", custom);
  buildServers();
  render();
});

$("exportBtn").addEventListener("click", () => {
  const rows = [["Server", "Khu vực", "Ping TB (ms)", "Tốt nhất (ms)", "Jitter (ms)", "Mất gói %"]];
  servers.filter(s => s.res).forEach(s => rows.push(
    s.res.dead
      ? [s.name, s.region, "không kết nối", "", "", 100]
      : [s.name, s.region, s.res.avg.toFixed(1), s.res.min.toFixed(1), s.res.jitter.toFixed(1), s.res.loss.toFixed(0)]
  ));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(",")).join("\n")], { type: "text/csv" }));
  a.download = "gfn-ping-ket-qua.csv";
  a.click();
});

["samples", "timeout", "conc"].forEach(id => {
  const v = load("gfn_" + id, null);
  if (v) $(id).value = v;
  $(id).addEventListener("change", () => save("gfn_" + id, $(id).value));
});

buildServers();
render();

const EXTRA_CODES = ["TYO","OSA","BOM","WAW","SOF","TOR","YTO","YYZ","SEA","DEN","HOU","SAT","MSP","BOS","SLC","LAS","IAD","EWR",
  "SEL","ICN","SIN","HKG","TPE","BKK","KUL","SYD","MEL","BOG","SCL","MVD","GRU","JNB","IST","ANK","MAD","MIL","ZRH","VIE",
  "PRG","BUD","CPH","HEL","OSL","DUB","MAN","BRU","LIS","ATH","MEX","DXB","RUH","EVN"];
const SCAN_CODES = [...new Set([
  ...Object.values(BASE).flat().map(z => z.replace(/[uv]$/, "").split("-")[0]),
  ...EXTRA_CODES
])];

let scanning = false, scanAbort = false;

async function scan() {
  if (scanning) { scanAbort = true; return; }
  scanning = true;
  scanAbort = false;
  const btn = $("scanBtn"), info = $("scanInfo");
  const finish = msg => {
    scanning = false;
    scanAbort = false;
    btn.textContent = "Quét thêm zone";
    info.textContent = msg;
    $("prog").style.width = "0";
  };
  btn.textContent = "Dừng quét";
  info.textContent = "Đang chuẩn bị quét...";
  if (await once("np-zzz-99" + SUFFIX, 2500) !== null)
    return finish("Không thể quét: mạng của bạn trả lời cả hostname không tồn tại, kết quả sẽ không chính xác.");

  const known = new Set(servers.map(s => s.host));
  const queue = [];
  for (const c of SCAN_CODES)
    for (let n = 1; n <= 10; n++) {
      const h = `np-${c.toLowerCase()}-${String(n).padStart(2, "0")}${SUFFIX}`;
      if (!known.has(h)) queue.push(h);
    }
  const total = queue.length;
  let done = 0, found = 0;
  const worker = async () => {
    while (queue.length && !scanAbort) {
      const h = queue.shift();
      const ms = await once(h, 2500);
      done++;
      if (ms !== null) {
        found++;
        custom.push({ name: h.split(".")[0].toUpperCase(), host: h, region: "Phát hiện mới" });
      }
      $("prog").style.width = (done / total * 100) + "%";
      info.textContent = `Đang quét ${done} / ${total} — tìm thấy ${found} zone mới`;
    }
  };
  await Promise.all(Array.from({ length: 12 }, worker));
  save("gfn_custom", custom);
  buildServers();
  render();
  finish(scanAbort
    ? `Đã dừng quét — tìm thấy ${found} zone mới.`
    : found
      ? `Quét xong — đã thêm ${found} zone mới vào mục “Phát hiện mới”. Bấm “Bắt đầu kiểm tra” để đo.`
      : "Quét xong — không tìm thấy zone mới.");
}

$("scanBtn").addEventListener("click", scan);