/**
 * tiktok-player.js - TikTok-Style Promo Video Player for 9jaCash
 * Implements full-screen overlay, vertical scrolling (4 slides), 
 * double-tap to like, floating action buttons (like, comment, favorite, share),
 * and dynamic comment section with simulated 5k comments.
 */

(function() {
  // Styles for the TikTok player
  const css = `
    /* Preloader screen styles */
    .tt-preloader-overlay {
      position: absolute;
      inset: 0;
      background: #000;
      z-index: 100000;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      transition: opacity 0.5s ease;
    }
    .tt-preloader-overlay.fade-out {
      opacity: 0;
      pointer-events: none;
    }
    .tt-preloader-circle-wrap {
      position: relative;
      width: 100px;
      height: 100px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 24px;
    }
    .tt-preloader-circle {
      position: absolute;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      border: 4px solid #1e293b;
      border-top-color: #06b6d4;
      animation: tt-spin 1.5s linear infinite;
    }
    .tt-preloader-play-icon {
      font-size: 24px;
      color: #06b6d4;
      z-index: 10;
      animation: tt-pulse 2s infinite ease-in-out;
    }
    .tt-preloader-title {
      font-size: 20px;
      font-weight: 800;
      margin-bottom: 8px;
      color: #f8fafc;
      letter-spacing: -0.5px;
    }
    .tt-preloader-subtitle {
      font-size: 14px;
      color: #64748b;
      margin-bottom: 32px;
      font-weight: 500;
    }
    .tt-preloader-bar-wrap {
      width: 200px;
      height: 4px;
      background: #1e293b;
      border-radius: 2px;
      overflow: hidden;
      position: relative;
    }
    .tt-preloader-bar-fill {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #06b6d4, #3b82f6);
      border-radius: 2px;
      transition: width 0.3s ease;
    }
    @keyframes tt-spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    @keyframes tt-pulse {
      0%, 100% { transform: scale(1); opacity: 0.8; }
      50% { transform: scale(1.15); opacity: 1; }
    }

    .tt-overlay {
      position: fixed;
      inset: 0;
      background: #000;
      z-index: 99999;
      display: flex;
      flex-direction: column;
      font-family: 'Plus Jakarta Sans', sans-serif;
      color: #fff;
      overflow: hidden;
      user-select: none;
    }
    .tt-header {
      position: absolute;
      top: 20px;
      left: 20px;
      z-index: 100;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .tt-back-btn {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 16px;
      transition: background 0.3s;
    }
    .tt-back-btn:hover {
      background: rgba(255, 255, 255, 0.2);
    }
    .tt-container {
      flex: 1;
      overflow-y: scroll;
      scroll-snap-type: y mandatory;
      scroll-behavior: smooth;
      -webkit-overflow-scrolling: touch;
    }
    .tt-container::-webkit-scrollbar {
      display: none;
    }
    .tt-slide {
      width: 100%;
      height: 100%;
      scroll-snap-align: start;
      scroll-snap-stop: always;
      position: relative;
      background: #000;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .tt-video-wrapper {
      position: relative;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .tt-video-bg {
      position: absolute;
      width: 100%;
      height: 100%;
      object-fit: cover;
      opacity: 0.35;
      filter: blur(20px);
      z-index: 1;
    }
    .tt-video {
      position: relative;
      z-index: 2;
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: transparent;
    }
    .tt-play-icon {
      position: absolute;
      z-index: 10;
      font-size: 64px;
      color: rgba(255, 255, 255, 0.7);
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s, transform 0.2s;
      transform: scale(1.5);
    }
    .tt-play-icon.show {
      opacity: 1;
      transform: scale(1);
    }
    /* Floating Sidebar */
    .tt-sidebar {
      position: absolute;
      right: 12px;
      bottom: 120px;
      z-index: 20;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 18px;
    }
    .tt-sidebar-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      background: none;
      border: none;
      color: #fff;
      cursor: pointer;
      outline: none;
    }
    .tt-sidebar-icon {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.45);
      border: 1px solid rgba(255, 255, 255, 0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      transition: transform 0.2s, background-color 0.2s;
      color: #fff;
      box-shadow: 0 4px 10px rgba(0,0,0,0.3);
    }
    .tt-sidebar-btn:active .tt-sidebar-icon {
      transform: scale(0.9);
    }
    .tt-sidebar-btn.liked .tt-sidebar-icon {
      color: #ff3b30;
      background-color: rgba(255, 59, 48, 0.1);
      border-color: rgba(255, 59, 48, 0.3);
    }
    .tt-sidebar-btn.favorited .tt-sidebar-icon {
      color: #ffcc00;
      background-color: rgba(255, 204, 0, 0.1);
      border-color: rgba(255, 204, 0, 0.3);
    }
    .tt-sidebar-label {
      font-size: 11px;
      font-weight: 700;
      color: #f1f5f9;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
    }
    /* Video Info Overlay */
    .tt-info {
      position: absolute;
      left: 16px;
      bottom: 24px;
      right: 80px;
      z-index: 20;
      text-align: left;
      text-shadow: 0 1px 3px rgba(0,0,0,0.8);
    }
    .tt-username {
      font-size: 15px;
      font-weight: 800;
      color: #fff;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .tt-username span {
      background: #00bfb2;
      color: #fff;
      font-size: 9px;
      padding: 1px 5px;
      border-radius: 4px;
      text-transform: uppercase;
      font-weight: 900;
    }
    .tt-desc {
      font-size: 13px;
      font-weight: 500;
      color: #e2e8f0;
      line-height: 1.4;
      margin-bottom: 8px;
    }
    .tt-music {
      font-size: 11px;
      color: #94a3b8;
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
    }
    .tt-music i {
      animation: rotateDisc 4s linear infinite;
    }
    @keyframes rotateDisc {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    /* Heart Popup Animation */
    .heart-popup {
      position: absolute;
      font-size: 80px;
      color: #ff3b30;
      pointer-events: none;
      z-index: 50;
      animation: flyHeart 0.8s ease-out forwards;
      text-shadow: 0 4px 15px rgba(255, 59, 48, 0.4);
    }
    @keyframes flyHeart {
      0% { transform: scale(0); opacity: 0; }
      15% { transform: scale(1.2); opacity: 0.9; }
      30% { transform: scale(1); opacity: 1; }
      100% { transform: translateY(-100px) rotate(15deg) scale(0.8); opacity: 0; }
    }
    /* Comment Modal (Slide Up) */
    .tt-comments-modal {
      position: absolute;
      left: 0;
      bottom: 0;
      width: 100%;
      height: 70%;
      background: #111827;
      border-radius: 20px 20px 0 0;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      z-index: 1000;
      transform: translateY(100%);
      transition: transform 0.35s cubic-bezier(0.25, 1, 0.5, 1);
      display: flex;
      flex-direction: column;
      box-shadow: 0 -10px 40px rgba(0,0,0,0.8);
    }
    .tt-comments-modal.show {
      transform: translateY(0);
    }
    .tt-comments-header {
      padding: 18px;
      text-align: center;
      font-size: 13px;
      font-weight: 800;
      color: #94a3b8;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      position: relative;
    }
    .tt-comments-close {
      position: absolute;
      right: 18px;
      top: 15px;
      background: none;
      border: none;
      color: #94a3b8;
      font-size: 18px;
      cursor: pointer;
    }
    .tt-comments-list {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      background: #111827;
    }
    .tt-comment-item {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      text-align: left;
    }
    .tt-comment-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 800;
      flex-shrink: 0;
    }
    .tt-comment-body {
      flex: 1;
    }
    .tt-comment-user {
      font-size: 12px;
      font-weight: 700;
      color: #94a3b8;
      margin-bottom: 2px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .tt-comment-text {
      font-size: 13px;
      color: #f1f5f9;
      line-height: 1.4;
    }
    .tt-comment-time {
      font-size: 10px;
      color: #64748b;
      margin-top: 4px;
      font-weight: 500;
    }
    .tt-comments-input-wrap {
      padding: 12px 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      background: #0f172a;
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .tt-comments-input {
      flex: 1;
      padding: 12px 16px;
      border-radius: 50px;
      background: #1e293b;
      border: 1px solid rgba(255,255,255,0.08);
      color: #fff;
      font-size: 13px;
      outline: none;
      font-family: inherit;
    }
    .tt-comments-send {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: #6366f1;
      color: #fff;
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
  `;

  // Inject styles
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // Pool of comments for dynamic generation
  const NIGERIAN_NAMES = [
    "chinedu_9ja", "funmi_9ja", "tunde_cash", "alabi_investor", "ngozi_wealth",
    "mustapha_wat", "joy_payout", "emeka_earn", "yetunde_gold", "ibrahim_kuda",
    "bose_cashout", "chioma_vfd", "kelechi_opay", "abubakar_key", "bolanle_9ja",
    "eze_invest", "favour_payout", "chike_payout", "solomon_rich", "amara_cash"
  ];

  const NIGERIAN_COMMENTS = [
    "Legit platform! I just withdrew ₦50,000 yesterday, cash landed under 2 mins.",
    "This 9jaCash is highly paying. Very fast key verification.",
    "Amina support is very active, helped me unlock my basic plan.",
    "9jaCash is working o! Make sure you link your account correctly.",
    "Who else is making money here? I started with ₦40,000, now on ₦160,000 return.",
    "I was skeptical before, but Christian admin verified my payout key and my money landed.",
    "Finally, a payout platform that pays instantly to Nigerian banks.",
    "The dark mode is so clean! Love the UI experience.",
    "Fast payouts, linked my Access bank account and it verified automatically.",
    "If your withdrawal is pending, just buy the payout key and submit proof. Cash is guaranteed.",
    "Is this real? Yes, got my alert this morning!",
    "No jokes, I have made over ₦120,000 this week from referral bonuses.",
    "Verified account is the key to unlimited withdrawals. Highly recommended.",
    "This platform is a lifesaver. Direct TRC20 secure network.",
    "My streak is 7 days already, daily check-in is boosting my payout status.",
    "Moniepoint payment receipt was approved in minutes. Very responsive.",
    "Kuda bank alert received! Thanks 9jaCash team.",
    "God bless the admins of this site, payment is smooth.",
    "Best investment of 2026. Fully CBN regulated, NDIC insured."
  ];

  // Helper to format counts in 'k' notation
  function formatCount(num) {
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'k';
    }
    return num;
  }

  // Double tap handler
  let lastTap = 0;
  function handleVideoDoubleTap(e, slideId, buttonEl, countEl) {
    const now = Date.now();
    if (now - lastTap < 300) {
      // Trigger like
      triggerLikeEffect(e);
      if (!buttonEl.classList.contains('liked')) {
        likeVideo(slideId, buttonEl, countEl);
      }
    }
    lastTap = now;
  }

  // Trigger floating heart on double click
  function triggerLikeEffect(e) {
    const wrapper = e.currentTarget;
    const rect = wrapper.getBoundingClientRect();
    // Get absolute coordinates from touch/click event
    let x = rect.width / 2;
    let y = rect.height / 2;
    if (e.clientX && e.clientY) {
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
    } else if (e.touches && e.touches[0]) {
      x = e.touches[0].clientX - rect.left;
      y = e.touches[0].clientY - rect.top;
    }

    const heart = document.createElement('i');
    heart.className = 'fa-solid fa-heart heart-popup';
    heart.style.left = `${x - 40}px`;
    heart.style.top = `${y - 40}px`;
    wrapper.appendChild(heart);

    setTimeout(() => heart.remove(), 800);
  }

  // Like video function
  function likeVideo(slideId, buttonEl, countEl) {
    buttonEl.classList.add('liked');
    const heartIcon = buttonEl.querySelector('i');
    heartIcon.className = 'fa-solid fa-heart';
    
    // Fetch and increment in backend SQL
    const API_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:') ? 'http://localhost:3000' : '';
    fetch(`${API_URL}/api/login-video/${slideId}/like`, { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        if (data.status) {
          countEl.textContent = formatCount(data.likes);
        } else {
          // Fallback local increment
          let curr = parseInt(countEl.dataset.value) || 0;
          curr++;
          countEl.textContent = formatCount(curr);
        }
      })
      .catch(() => {
        let curr = parseInt(countEl.dataset.value) || 0;
        curr++;
        countEl.textContent = formatCount(curr);
      });
  }

  // Generate dynamic list of comments (simulating 5k comments)
  function renderComments(container) {
    container.innerHTML = '';
    
    // Generate 35 highly realistic comments initially, with scroll loader
    for (let i = 0; i < 35; i++) {
      const item = createCommentElement(i);
      container.appendChild(item);
    }

    // Add scroll listener for infinite comment scroll to simulate 5,000 comments
    container.addEventListener('scroll', function() {
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 50) {
        // Load 15 more
        for (let i = 0; i < 15; i++) {
          const item = createCommentElement(container.children.length);
          container.appendChild(item);
        }
      }
    });
  }

  function createCommentElement(index, customText = null, customUser = null) {
    const user = customUser || '@' + NIGERIAN_NAMES[Math.floor(Math.random() * NIGERIAN_NAMES.length)];
    const comment = customText || NIGERIAN_COMMENTS[Math.floor(Math.random() * NIGERIAN_COMMENTS.length)];
    
    // Hours/days ago
    let timeAgo = '';
    if (index === 0) timeAgo = 'Just now';
    else if (index < 5) timeAgo = `${index}m ago`;
    else if (index < 24) timeAgo = `${Math.floor(index / 2) + 1}h ago`;
    else timeAgo = `${Math.floor(index / 24) + 1}d ago`;

    const el = document.createElement('div');
    el.className = 'tt-comment-item';
    el.innerHTML = `
      <div class="tt-comment-avatar">
        ${user.replace('@','').substring(0, 2).toUpperCase()}
      </div>
      <div class="tt-comment-body">
        <div class="tt-comment-user">${user}</div>
        <div class="tt-comment-text">${comment}</div>
        <div class="tt-comment-time">${timeAgo}</div>
      </div>
    `;
    return el;
  }

  // Show TikTok Modal
  window.showTikTokModal = function(videos, startIndex = 0, onWatchedCallback) {
    if (!videos || videos.length === 0) {
      console.warn("No videos provided to TikTok player.");
      return;
    }

    // Create modal wrapper
    const overlay = document.createElement('div');
    overlay.className = 'tt-overlay';
    overlay.id = 'tiktokModalOverlay';

    // Create preloader overlay
    const preloader = document.createElement('div');
    preloader.className = 'tt-preloader-overlay';
    preloader.innerHTML = `
      <div class="tt-preloader-circle-wrap">
        <div class="tt-preloader-circle"></div>
        <i class="fa-solid fa-play tt-preloader-play-icon"></i>
      </div>
      <div class="tt-preloader-title">Preparing Videos</div>
      <div class="tt-preloader-subtitle" id="ttPreloaderSubtitle">Loading 0 of ${videos.length}...</div>
      <div class="tt-preloader-bar-wrap">
        <div class="tt-preloader-bar-fill" id="ttPreloaderBarFill"></div>
      </div>
    `;
    overlay.appendChild(preloader);

    let loadedCount = 0;
    const subtitleEl = preloader.querySelector('#ttPreloaderSubtitle');
    const barEl = preloader.querySelector('#ttPreloaderBarFill');
    let targetIndex = startIndex >= 0 && startIndex < videos.length ? startIndex : 0;
    let isDismissed = false;

    function dismissPreloader() {
      if (isDismissed) return;
      isDismissed = true;
      preloader.classList.add('fade-out');
      setTimeout(() => {
        preloader.remove();
        // Play the active video
        if (slideVideoElements[activeIndex]) {
          slideVideoElements[activeIndex].video.play().catch(() => {});
          slideVideoElements[activeIndex].bg.play().catch(() => {});
          slideVideoElements[activeIndex].playIcon.classList.remove('show');
        }
      }, 500);
    }

    // Safeguard timeout to dismiss preloader in max 5 seconds
    setTimeout(dismissPreloader, 5000);

    const loadedIndices = new Set();
    function markVideoLoaded(idx) {
      if (loadedIndices.has(idx)) return;
      loadedIndices.add(idx);
      loadedCount = loadedIndices.size;
      
      const percent = Math.min(100, Math.round((loadedCount / videos.length) * 100));
      if (barEl) barEl.style.width = percent + '%';
      if (subtitleEl) subtitleEl.textContent = `Loading ${loadedCount} of ${videos.length}...`;
      
      if (idx === targetIndex) {
        dismissPreloader();
      }
    }

    // Header
    const header = document.createElement('div');
    header.className = 'tt-header';
    
    const backBtn = document.createElement('button');
    backBtn.className = 'tt-back-btn';
    backBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i>';
    backBtn.onclick = function() {
      // Pause all videos
      const activeVideos = overlay.querySelectorAll('video');
      activeVideos.forEach(v => v.pause());
      
      overlay.remove();
      if (onWatchedCallback) onWatchedCallback();
    };
    header.appendChild(backBtn);
    overlay.appendChild(header);

    // Scrollable Container
    const container = document.createElement('div');
    container.className = 'tt-container';
    overlay.appendChild(container);

    // Comments sliding overlay
    const commentsModal = document.createElement('div');
    commentsModal.className = 'tt-comments-modal';
    commentsModal.innerHTML = `
      <div class="tt-comments-header">
        Comments (5.0k)
        <button class="tt-comments-close">✕</button>
      </div>
      <div class="tt-comments-list"></div>
      <div class="tt-comments-input-wrap">
        <input type="text" class="tt-comments-input" placeholder="Add comment..." />
        <button class="tt-comments-send"><i class="fa-solid fa-paper-plane"></i></button>
      </div>
    `;
    overlay.appendChild(commentsModal);

    const commentsList = commentsModal.querySelector('.tt-comments-list');
    const commentsInput = commentsModal.querySelector('.tt-comments-input');
    const commentsSend = commentsModal.querySelector('.tt-comments-send');
    const commentsClose = commentsModal.querySelector('.tt-comments-close');

    commentsClose.onclick = () => commentsModal.classList.remove('show');
    
    commentsSend.onclick = function() {
      const val = commentsInput.value.trim();
      if (!val) return;
      // Add custom user comment
      const newComment = createCommentElement(0, val, '@you');
      commentsList.insertBefore(newComment, commentsList.firstChild);
      commentsInput.value = '';
      commentsList.scrollTop = 0;
    };
    commentsInput.onkeydown = function(e) {
      if (e.key === 'Enter') commentsSend.click();
    };

    // Render slides
    const slideVideoElements = [];
    videos.forEach((video, index) => {
      const slide = document.createElement('div');
      slide.className = 'tt-slide';
      slide.dataset.index = index;

      const likesCount = video.likes_count || 255700;
      const favsCount = video.favorites_count || 12000;
      const sharesCount = video.shares_count || 8500;

      let finalSrc = video.video_url || "";
      if (finalSrc.startsWith("/")) {
        const base = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:') ? 'http://localhost:3000' : '';
        finalSrc = base + finalSrc;
      }

      slide.innerHTML = `
        <div class="tt-video-wrapper">
          <video class="tt-video-bg" src="${finalSrc}" loop muted preload="auto"></video>
          <video class="tt-video" src="${finalSrc}" loop playsinline webkit-playsinline preload="auto"></video>
          <i class="fa-solid fa-play tt-play-icon"></i>
          
          <!-- Floating Action Buttons -->
          <div class="tt-sidebar">
            <button class="tt-sidebar-btn" id="likeBtn_${video.id}">
              <div class="tt-sidebar-icon"><i class="fa-regular fa-heart"></i></div>
              <span class="tt-sidebar-label" id="likeCount_${video.id}" data-value="${likesCount}">${formatCount(likesCount)}</span>
            </button>
            <button class="tt-sidebar-btn" id="commentBtn_${video.id}">
              <div class="tt-sidebar-icon"><i class="fa-regular fa-comment-dots"></i></div>
              <span class="tt-sidebar-label">5.0k</span>
            </button>
            <button class="tt-sidebar-btn" id="favBtn_${video.id}">
              <div class="tt-sidebar-icon"><i class="fa-regular fa-bookmark"></i></div>
              <span class="tt-sidebar-label" id="favCount_${video.id}">${formatCount(favsCount)}</span>
            </button>
            <button class="tt-sidebar-btn" id="shareBtn_${video.id}">
              <div class="tt-sidebar-icon"><i class="fa-solid fa-share"></i></div>
              <span class="tt-sidebar-label">${formatCount(sharesCount)}</span>
            </button>
          </div>

          <!-- Video Details -->
          <div class="tt-info">
            <div class="tt-username">@9jaCash_Official <span>Official</span></div>
            <div class="tt-desc">${video.caption || "How to earn ₦50,000 daily with 9jaCash secure payment system. Verified payouts and payout keys. 🚀💸 #9jaCash #PayoutKey #MakeMoney"}</div>
            <div class="tt-music">
              <i class="fa-solid fa-compact-disc"></i> original sound - 9jaCash Testimonial
            </div>
          </div>
        </div>
      `;

      container.appendChild(slide);

      const videoElement = slide.querySelector('.tt-video');
      const videoBg = slide.querySelector('.tt-video-bg');
      const playIcon = slide.querySelector('.tt-play-icon');
      const wrapper = slide.querySelector('.tt-video-wrapper');
      
      const lBtn = slide.querySelector(`#likeBtn_${video.id}`);
      const lCount = slide.querySelector(`#likeCount_${video.id}`);
      const cBtn = slide.querySelector(`#commentBtn_${video.id}`);
      const fBtn = slide.querySelector(`#favBtn_${video.id}`);
      const fCount = slide.querySelector(`#favCount_${video.id}`);
      const sBtn = slide.querySelector(`#shareBtn_${video.id}`);

      slideVideoElements.push({
        video: videoElement,
        bg: videoBg,
        playIcon: playIcon
      });

      // Track buffer load state
      videoElement.addEventListener('loadeddata', function() { markVideoLoaded(index); });
      videoElement.addEventListener('canplay', function() { markVideoLoaded(index); });
      videoElement.addEventListener('canplaythrough', function() { markVideoLoaded(index); });
      if (videoElement.readyState >= 2) {
        markVideoLoaded(index);
      }

      // Handle video click (play/pause)
      videoElement.addEventListener('click', function() {
        if (videoElement.paused) {
          videoElement.play();
          videoBg.play();
          playIcon.classList.remove('show');
        } else {
          videoElement.pause();
          videoBg.pause();
          playIcon.classList.add('show');
        }
      });

      // Double click to like
      wrapper.addEventListener('click', function(e) {
        if (e.target.closest('.tt-sidebar')) return;
        handleVideoDoubleTap(e, video.id, lBtn, lCount);
      });

      // Sidebar Action Handlers
      lBtn.addEventListener('click', function() {
        if (lBtn.classList.contains('liked')) {
          lBtn.classList.remove('liked');
          lBtn.querySelector('i').className = 'fa-regular fa-heart';
          let curr = parseInt(lCount.dataset.value) || 0;
          if (curr > 0) curr--;
          lCount.dataset.value = curr;
          lCount.textContent = formatCount(curr);
        } else {
          likeVideo(video.id, lBtn, lCount);
        }
      });

      cBtn.addEventListener('click', function() {
        commentsModal.classList.add('show');
        renderComments(commentsList);
      });

      fBtn.addEventListener('click', function() {
        fBtn.classList.toggle('favorited');
        const icon = fBtn.querySelector('i');
        const label = fCount;
        let count = parseInt(label.textContent.replace('k','')) * 1000;
        if (fBtn.classList.contains('favorited')) {
          icon.className = 'fa-solid fa-bookmark';
          count++;
        } else {
          icon.className = 'fa-regular fa-bookmark';
          count--;
        }
        label.textContent = formatCount(count);
      });

      sBtn.addEventListener('click', function() {
        const tempInput = document.createElement('input');
        tempInput.value = window.location.origin;
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand('copy');
        document.body.removeChild(tempInput);
        
        // Show temporary toast
        const shareLabel = sBtn.querySelector('.tt-sidebar-label');
        const origText = shareLabel.textContent;
        shareLabel.textContent = "Copied!";
        shareLabel.style.color = "#10b981";
        setTimeout(() => {
          shareLabel.textContent = origText;
          shareLabel.style.color = "";
        }, 1500);
      });
    });

    // Handle scroll to active/pause videos
    let activeIndex = startIndex;
    container.addEventListener('scroll', function() {
      const height = container.clientHeight;
      const index = Math.round(container.scrollTop / height);
      if (index !== activeIndex && index >= 0 && index < videos.length) {
        // Pause old video
        if (slideVideoElements[activeIndex]) {
          slideVideoElements[activeIndex].video.pause();
          slideVideoElements[activeIndex].bg.pause();
          slideVideoElements[activeIndex].playIcon.classList.add('show');
        }
        // Play new video
        activeIndex = index;
        if (slideVideoElements[activeIndex]) {
          slideVideoElements[activeIndex].video.play().catch(() => {});
          slideVideoElements[activeIndex].bg.play().catch(() => {});
          slideVideoElements[activeIndex].playIcon.classList.remove('show');
        }
      }
    });

    document.body.appendChild(overlay);

    // Initial play after modal opens
    setTimeout(() => {
      // Scroll to start index if not 0
      if (startIndex > 0) {
        container.scrollTop = startIndex * container.clientHeight;
      }
      if (isDismissed) {
        if (slideVideoElements[activeIndex]) {
          slideVideoElements[activeIndex].video.play().catch(() => {});
          slideVideoElements[activeIndex].bg.play().catch(() => {});
          slideVideoElements[activeIndex].playIcon.classList.remove('show');
        }
      }
    }, 200);
  };
})();
