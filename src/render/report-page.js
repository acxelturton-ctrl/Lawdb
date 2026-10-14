// "Report a listing" page: a short form anyone can use to flag a wrong, misleading or unauthorised listing.
// Built from the same header/footer/styles as every other page. Reports arrive as leads (form "report-listing")
// and the admin is emailed.
import * as C from './firm-chunks.generated.js';
import { esc } from './firm-page.js';

const REASONS = [
  ['inaccurate', 'The information is wrong or out of date'],
  ['claims', 'It makes misleading or prohibited claims'],
  ['notowner', 'Someone who does not run this firm is managing it'],
  ['notfirm', 'This is not a law firm, or it has closed'],
  ['spam', 'Spam or inappropriate content'],
  ['other', 'Something else'],
];

export function renderReportPage({ slug = '', firmName = '' }) {
  const label = firmName ? `Report: ${esc(firmName)}` : 'Report a listing';
  const css = `
.rp{max-width:560px;margin:28px auto;background:#fff;border:1px solid #e4ded3;border-radius:12px;padding:22px}
.rp h1{font-size:22px;margin:0 0 6px}.rp p{color:#6b645a;font-size:14px;line-height:1.5}
.rp label{display:block;font-weight:600;font-size:14px;margin:14px 0 4px}
.rp input,.rp select,.rp textarea{width:100%;box-sizing:border-box;padding:10px 12px;font:inherit;border:1px solid #d9d3c7;border-radius:6px;background:#fff}
.rp textarea{min-height:110px}.rp button{margin-top:16px;background:#2b2723;color:#fff;border:0;border-radius:6px;padding:12px 22px;font-weight:700;font:inherit;cursor:pointer}
.rp .ok{background:#e8f3ea;color:#1e6b3a;padding:12px;border-radius:8px}.rp .err{background:#fbeceb;color:#a1261c;padding:10px;border-radius:8px;margin-top:12px}`;
  return [
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n' + C.FAVICONS + '\n<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<title>${label} | LawDB</title>\n<meta name="robots" content="noindex, nofollow">`,
    C.STYLE + '\n<link rel="stylesheet" href="/desktop.css">\n<link rel="stylesheet" href="/site.css">\n<style>' + css + '</style>\n</head>',
    '<body>\n  ' + C.HEADER,
    '  <div class="wrap">\n    <div class="rp">',
    `      <h1>${label}</h1>`,
    '      <p>Tell us what is wrong and we will look into it. We may contact you at the email you give. We do not share your details with the firm.</p>',
    '      <form id="rp-form" novalidate>',
    '        <input type="text" name="botcheck" tabindex="-1" autocomplete="off" style="display:none" aria-hidden="true">',
    `        <input type="hidden" name="reportedFirm" value="${esc(slug)}">`,
    `        <label for="rp-reason">What is the problem?</label><select id="rp-reason" name="reason">${REASONS.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select>`,
    '        <label for="rp-msg">Details</label><textarea id="rp-msg" name="message" maxlength="2000" placeholder="What is wrong, and what should it say instead?"></textarea>',
    '        <label for="rp-name">Your name</label><input id="rp-name" name="name" type="text" autocomplete="name" maxlength="100">',
    '        <label for="rp-email">Your email</label><input id="rp-email" name="email" type="email" autocomplete="email" maxlength="254">',
    '        <button type="submit" id="rp-btn">Send report</button>',
    '      </form>',
    '      <div id="rp-out" role="status"></div>',
    '    </div>',
    '  </div>',
    '  ' + C.FOOTER,
    `<script>
(function(){
  var f=document.getElementById('rp-form'),b=document.getElementById('rp-btn'),o=document.getElementById('rp-out');
  f.addEventListener('submit',function(e){
    e.preventDefault();
    var d={form:'report-listing',name:f.name.value.trim(),email:f.email.value.trim(),reason:f.reason.value,reportedFirm:f.reportedFirm.value,botcheck:f.botcheck.value,message:f.message.value.trim(),page:location.href};
    if(!d.name||!d.email||!d.message){o.className='err';o.textContent='Please fill in the details, your name and your email.';return;}
    b.disabled=true;b.textContent='Sending...';
    fetch('/api/leads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d)})
      .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
      .then(function(x){
        if(x.ok){f.style.display='none';o.className='ok';o.textContent='Thank you. We have your report and will look into it.';}
        else{o.className='err';o.textContent=(x.j&&x.j.error)||'Something went wrong. Please try again.';b.disabled=false;b.textContent='Send report';}
      }).catch(function(){o.className='err';o.textContent='Network problem. Please try again.';b.disabled=false;b.textContent='Send report';});
  });
})();
</script>`,
    '</body>\n</html>\n',
  ].join('\n');
}
