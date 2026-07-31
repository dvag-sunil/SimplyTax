const elStub = () => ({ addEventListener(){}, innerHTML:'', classList:{add(){},remove(){}}, click(){}, value:'',
  appendChild(){}, remove(){}, focus(){}, setSelectionRange(){}, select(){}, hasAttribute(){return false;},
  getAttribute(){return null;}, disabled:false, offsetParent:{}, dataset:{} });
global.document = { getElementById:()=>elStub(), querySelector:()=>null, querySelectorAll:()=>[],
  createElement:()=>elStub(), body:{appendChild(){},removeChild(){}}, head:{appendChild(){}},
  addEventListener(){}, removeEventListener(){} };
global.window = global;
global.localStorage = { getItem:()=>null, setItem(){}, removeItem(){} };
global.location = { search:'', pathname:'/', href:'' };
global.history = { replaceState(){} };
global.navigator = { language:'en-US' };
global.fetch = async () => ({ ok:true, json: async () => ({}) });
global.URLSearchParams = URLSearchParams;
global.crypto = require('crypto').webcrypto;
global.self = global;
