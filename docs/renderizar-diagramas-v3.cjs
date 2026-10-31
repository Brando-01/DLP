// Renderizar las dos fuentes SVG a PNG, sin alterar la aplicación.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.DLP_PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
  const browser = await chromium.launch({headless:true, ...(process.env.DLP_CHROMIUM_PATH ? {executablePath:process.env.DLP_CHROMIUM_PATH}: {})});
  try {
    for(const name of ['01-casos-de-uso-dlp-v3','02-red-dlp-v3']) {
      const file=path.join(__dirname,'diagramas','v3',name+'.svg');
      const raw=fs.readFileSync(file,'utf8');
      const [,w,h]=raw.match(/width="(\d+)" height="(\d+)"/);
      const page=await browser.newPage({viewport:{width:+w,height:+h},deviceScaleFactor:1.5});
      await page.setContent('<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}svg{display:block}</style></head><body>'+raw+'</body></html>');
      await page.evaluate(()=>document.fonts.ready);
      const overflows=await page.evaluate(()=>{
        const root=document.querySelector('svg');
        const rects=[...root.querySelectorAll('rect')];
        const bad=[];
        for(const t of root.querySelectorAll('text')) {
          const b=t.getBBox(), x=+t.getAttribute('x'), y=+t.getAttribute('y');
          const enclosing=rects.filter(r=>{
            const q=r.getBBox();return x>q.x+10&&x<q.x+q.width-10&&y>q.y+10&&y<q.y+q.height-5;
          }).sort((a,b)=>a.getBBox().width*a.getBBox().height-b.getBBox().width*b.getBBox().height)[0];
          if(enclosing) {
            const q=enclosing.getBBox();
            if(b.x+b.width>q.x+q.width-12)bad.push({text:t.textContent,overflow:Math.round(b.x+b.width-(q.x+q.width-12))});
          }
        }
        return bad;
      });
      console.log(JSON.stringify({name,overflows}));
      await page.screenshot({path:file.replace('.svg','.png'),fullPage:true,timeout:15000,animations:'disabled'});
      await page.close();
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
