PRELUDE = r"""
window.api = async (path) => { if (String(path).includes('certificate/status')) return {hasCertificate:false}; return {}; };
S.loggedIn=true; S.user={name:'Maximilian Mustermann-Schmidt', email:'maximilian.mustermann-schmidt@example.com', settings:{}}; S.lang='de'; S.clients=[];
const mk = (first,last,year,marital) => {
  const c = newClient(first,last,year,marital);
  Object.assign(c.p,{birthDate:'1980-02-01',taxId:'12345678901',street:'Hauptstrasse am Waldrand',houseNo:'123a',plz:'60528',
    city:'Frankfurt am Main-Sachsenhausen',iban:'DE89370400440532013000',finanzamt:'Finanzamt Frankfurt am Main V-Hoechst',
    profession:'Wirtschaftsinformatiker'});
  if (marital==='married') Object.assign(c.p,{spouseFirst:'Annemarie-Luise',spouseLast:'Mustermann-Schmidt',spouseBirth:'1982-03-04',
    spouseTaxId:'98765432109',spouseProfession:'Lehrerin',marriageDate:'2010-06-15'});
  c.emps=[{id:'e1',person:'A',employer:'Sehr Lange Arbeitgeber Beratungs- und Verwaltungsgesellschaft GmbH & Co. KG',gross:'85000',wageTax:'18000'}];
  c.kap=[{id:'k1',person:'A',institut:'Trade Republic Bank GmbH'}];
  c.props=[{id:'p1',street:'Beispielstrasse',houseNo:'1',plz:'10115',city:'Berlin',rent:'12000',costs:'3000',owner:'A'}];
  c.privIns=[{id:'i1',type:'haftpflicht',amount:'120'}];
  c.wkItems=[{id:'w1',type:'arbeitsmittel',amount:'300'}];
  c.rente=[{id:'r1'}];
  c.fam.children=[{id:'ch1',name:'Tom Mustermann-Schmidt',birth:'2015-05-01',taxId:'12345678901',kinship:'leiblich',familienkasse:'Familienkasse Hessen',
    otherParentName:'',childcare:'1200',ccProvider:'Kinderbetreuungsgesellschaft',efaOtherAdultPresent:'ja',efaHouseholdCommunity:'ja'}];
  c.unt=[{id:'u1',support:1200,untName:'Anna',untCountry:'Indien',untForeignConfirmed:'ja',untRelationship:'Tochter'}];
  return c;
};
const c = mk('Maximilian','Mustermann-Schmidt',2025,'married');
const c2 = mk('Anna','Kurz',2024,'single'); c2.status='submitted';
S.clients=[c,c2]; S.currentId=c.id;
"""

def go(extra):
    return PRELUDE + extra

def step(n):
    return go(f"S.view='client'; S.step={n}; render();")

app_core = [
    ('app:login',      'index.html', None),
    ('app:register',   'index.html', "S.authMode='register'; render();"),
    ('app:forgot',     'index.html', "S.authMode='forgot'; render();"),
    ('app:dashboard',  'index.html', go("S.view='dash'; render();")),
]
app_steps = [(f'app:step{n}', 'index.html', step(n)) for n in range(12)]
app_modals = [
    ('app:locked-step0', 'index.html', go("S.view='client'; S.currentId=c2.id; S.step=0; render();")),
    ('app:modal-newclient', 'index.html', go("S.view='dash'; render(); showNewClientModal();")),
    ('app:modal-newyear', 'index.html', go("S.view='dash'; render(); showNewYear(c.id);")),
    ('app:modal-cert', 'index.html', go("S.view='dash'; render(); showCertificateSettings();")),
    ('app:settings', 'index.html', go("S.view='dash'; render(); showSettings();")),
    ('app:modal-freigabe', 'index.html', go("S.view='client'; S.step=10; render(); showFreigabeModal(c, {}, {skippedSections:['[SENT] Sonderausgaben (donations): a second person exists on this return, but no owner was selected for this donation - defaulted to attributing the full amount to Person A.','[MATERIAL] Marriage date missing'], ericLogTail:'x'});")),
]
