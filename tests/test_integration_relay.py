import hashlib,json,re,shutil
from pathlib import Path
import pytest
from test_p0_node import run_js,run_node
P=Path(__file__).parents[1];W=P/"web";V="vicfos99-tech.github.io";J=json.loads((P/"tests/test_integration_data_base.json").read_bytes())
N="c1 c2 s3 s3c s4 s5 s6 s7 s8 s9 c18".split()
@pytest.fixture(scope="module")
def r():return run_js("test_integration_relay.js")
@pytest.mark.parametrize("n",N+[0])
def test_flow(r,n):assert r.get(n,{}).get("ok")if n else set(r)==set(N),r
def test_same():assert J["app"]=="d201f923e197fa8e0fc7e03e520fbf4f8398bf69c5158b5d1419344f4d15ae87"and len(J["files"])==13 and{f:hashlib.sha256((P/f).read_bytes().replace(b"\r\n",b"\n")).hexdigest()for f in J["files"]}==J["files"]
def test_text():
 a,i=[(W/f).read_text("utf-8")for f in("app.js","index.html")];x=re.findall('id="(relay-(?:form|on|base|msg)|live-form)"',i)
 assert not re.search('<div class="mk|<br>|<b>|mk-pop|(inner|outer|insertAdjacent)HTML|document.write|const esc =',a)and V not in a and V not in i and a.count("divIcon(")==len(re.findall(r"html: \w+\.(bubble|line|dot)Html\(",a))>0<a.count("popupHtml(")and i.count('"relay.js"')==1 and re.search('(?s)"around.js".*"relay.js".*"app.js"',i)and len(x)==len({*x})==5 and x.index("relay-form")<x.index("live-form")and"checkbox"in re.search('<[^>]*id="relay-on"[^>]*>',i)[0]
def test_build(tmp_path):
 k=lambda:[p.read_bytes()for p in(W/"dist").glob("*")];b=k();x=tmp_path/"web";shutil.copytree(W,x,ignore=shutil.ignore_patterns("dist","test"));c,o,e=run_node([x/"build.js"]);x/="dist";s=(x/"index.html").read_text("utf-8")
 assert c==0 and(x/"artifact.html").exists()and(x/"충전길잡이.html").exists()and V+"/ev-station-map/relay/"in s and"<script src="not in s and k()==b,e
 for f in(W/"test").glob("*.js"):assert"navi"in f.name and not(W/"test/navi_fixture.json").exists()or run_node([f],cwd=P)[0]==0
