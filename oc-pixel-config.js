/* ============================================================
   시티오씨엘 9단지 — 광고 채널 전환추적 설정 파일
   ------------------------------------------------------------
   · 따옴표 안에 ID를 채워 넣으면 그 채널만 자동으로 켜집니다.
   · 빈 값('')인 채널은 아무 스크립트도 불러오지 않습니다. (광고 전에도 안전)
   · index.html(방문 기록) / thankyou.html(신청 전환)이 이 파일 하나를 공유합니다.
   ============================================================ */
window.OC_PIXELS = {
  /* 메타(페이스북·인스타그램) : 이벤트 관리자 → 픽셀 ID (숫자 15~16자리) */
  meta: { id: '' },

  /* 구글 : Google Ads 전환 → 전환 ID(AW-XXXXXXXXXX) + 전환 라벨 */
  google: { id: '', label: '' },

  /* 카카오 : 카카오비즈니스 픽셀&SDK → 픽셀 ID  (ID를 주시면 공식 스크립트로 연결) */
  kakao: { id: '' },

  /* 당근 : 광고계정 픽셀&SDK → 픽셀 ID  ★연결완료 (전환 추적 코드 ID 1790663484175003001) */
  daangn: { id: '1790663484175003001' },

  /* 네이버 : 프리미엄 로그분석 신청 후 메일로 받는 스크립트 원문 → 그대로 전달주시면 삽입 */
  naver: { ready: false }
};

/* ================= 이하 자동 동작부 (수정 불필요) ================= */
(function () {
  'use strict';
  var P = window.OC_PIXELS || {};
  var isTY = /thankyou\.html$/i.test(location.pathname);

  function addScript(src) {
    var s = document.createElement('script');
    s.async = true; s.src = src;
    (document.head || document.documentElement).appendChild(s);
  }

  /* --- 메타 픽셀 (표준 부트스트랩) --- */
  function meta() {
    if (!(P.meta && P.meta.id)) return null;
    if (!window.fbq) {
      var n = window.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!window._fbq) window._fbq = n;
      n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
      addScript('https://connect.facebook.net/en_US/fbevents.js');
      n('init', P.meta.id);
    }
    return window.fbq;
  }

  /* --- 구글 전환 태그 (config 시 페이지뷰 1건이 자동 집계됨) --- */
  function gtagInit() {
    if (!(P.google && P.google.id && String(P.google.id).indexOf('AW-') === 0)) return false;
    window.dataLayer = window.dataLayer || [];
    if (!window.gtag) {
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag.l = 1 * new Date();
      addScript('https://www.googletagmanager.com/gtag/js?id=' + P.google.id);
    }
    window.gtag('config', P.google.id);
    return true;
  }

  /* --- 당근 픽셀 (Danggeun Market Code 공식 부트스트랩) --- */
  function daangn() {
    if (!(P.daangn && P.daangn.id)) return null;
    if (!window.karrotPixel) {
      (function (w, d) {
        if (w.karrotPixel) return;
        var k = { stub: true, queue: [] };
        k.init = function () { k.queue.push(['init', arguments, Date.now()]); };
        k.track = function () { k.queue.push(['track', arguments, Date.now()]); };
        w.karrotPixel = k;
        var s = d.createElement('script');
        s.async = true;
        s.src = 'https://karrot-pixel.business.daangn.com/karrot-pixel.js';
        var f = d.getElementsByTagName('script')[0];
        f && f.parentNode ? f.parentNode.insertBefore(s, f) : d.head.appendChild(s);
      })(window, document);
      window.karrotPixel.init(P.daangn.id);
    }
    return window.karrotPixel;
  }

  function start() {
    if (!isTY) {
      /* 메인 페이지 : 채널별 방문(ViewPage/PageView) 기록 */
      var fb = meta();
      if (fb) fb('track', 'PageView');
      gtagInit();
      /* 당근 : 방문 기록 (ViewPage) */
      var dk = daangn();
      if (dk) dk.track('ViewPage');
      /* 카카오·네이버 공통(방문) 스크립트는 ID 연결 시 이 자리에서 자동 활성화 */
    } else {
      /* 신청 완료 페이지 : 채널별 전환 발화 (eid와 함께) */
      var eid = (new URLSearchParams(location.search).get('eid')) || '';
      var fb2 = meta();
      if (fb2) fb2('track', 'Lead', { event_id: eid });
      if (gtagInit() && P.google.label) {
        window.gtag('event', 'conversion', { send_to: P.google.id + '/' + P.google.label });
      }
      /* 당근 : 페이지뷰 + 신청 완료 전환 (SubmitApplication) */
      var dk2 = daangn();
      if (dk2) { dk2.track('ViewPage'); dk2.track('SubmitApplication'); }
      /* 카카오(SubmitApplication)·네이버(전환)도 ID 연결 시 이 자리에서 자동 발화 */
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ event: 'oc_conversion', eid: eid });
    }
  }

  /* 페이지 로딩 끝난 뒤 붙습니다 — 본문 로딩 속도에 영향 없음 */
  if (document.readyState === 'complete') setTimeout(start, 300);
  else window.addEventListener('load', function () { setTimeout(start, 300); });
})();
