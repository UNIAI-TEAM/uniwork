# usage: measure.py <label> -- cmd...   prints JSON {label, wall_s, peak_rss_mb, exit}
import subprocess, sys, time, os, json
label = sys.argv[1]; cmd = sys.argv[3:]
def tree(pid):
    kids = {}
    for p in os.listdir('/proc'):
        if not p.isdigit(): continue
        try:
            with open(f'/proc/{p}/stat') as f: pp = int(f.read().rsplit(')',1)[1].split()[1])
            kids.setdefault(pp, []).append(int(p))
        except Exception: pass
    out, st = [], [pid]
    while st:
        x = st.pop(); out.append(x); st += kids.get(x, [])
    return out
def rss(pids):
    t = 0
    for p in pids:
        try:
            with open(f'/proc/{p}/status') as f:
                for l in f:
                    if l.startswith('VmRSS:'): t += int(l.split()[1])
        except Exception: pass
    return t
t0 = time.time(); pr = subprocess.Popen(cmd); peak = 0
while pr.poll() is None:
    peak = max(peak, rss(tree(pr.pid))); time.sleep(0.05)
print(json.dumps({"label": label, "wall_s": round(time.time()-t0, 2), "peak_rss_mb": round(peak/1024), "exit": pr.returncode}), flush=True)
