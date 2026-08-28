/* Design reminder: “验证过的阅读”——以清晰资料索引、可扫描卡片和克制动态承载真实微博数据。 */
const state = {
  index: null,
  posts: [],
  loadedYears: new Set(),
  activeAuthor: "all",
  activeYear: "all",
  activeType: "all",
  query: "",
  sort: "new",
  visibleLimit: 28,
  loading: false,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const formatter = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });
const dateFormatter = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
const dateShortFormatter = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" });

function escapeHtml(value = "") {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function initials(name = "微博") {
  return escapeHtml(name.slice(0, 2).toUpperCase());
}

function number(value) {
  return formatter.format(Number(value || 0));
}

function dateFrom(post) {
  return new Date(post.timestamp);
}

function dayKey(post) {
  const date = dateFrom(post);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function setLoading(isLoading, message = "正在整理本地资料…") {
  state.loading = isLoading;
  $("#loadingState").hidden = !isLoading;
  $("#loadingState p").textContent = message;
  $("#loadAllButton").disabled = isLoading || state.loadedYears.size === state.index?.years.length;
}

async function getYear(year) {
  if (state.loadedYears.has(year)) return;
  const response = await fetch(`reader-data/weibo-${year}.json`);
  if (!response.ok) throw new Error(`无法读取 ${year} 年数据`);
  const payload = await response.json();
  const knownIds = new Set(state.posts.map((post) => post.id));
  state.posts.push(...payload.posts.filter((post) => !knownIds.has(post.id)));
  state.loadedYears.add(year);
}

async function loadAllArchive() {
  if (!state.index || state.loading || state.loadedYears.size === state.index.years.length) return;
  setLoading(true, "正在按年份装订完整资料库…");
  try {
    const pendingYears = state.index.years.map((entry) => entry.value).filter((year) => !state.loadedYears.has(year));
    for (const [position, year] of pendingYears.entries()) {
      setLoading(true, `正在载入 ${year} 年资料（${position + 1}/${pendingYears.length}）…`);
      await getYear(year);
    }
  } catch (error) {
    console.error(error);
    $("#dataStatus").textContent = "有部分资料未能读取";
  } finally {
    setLoading(false);
    state.visibleLimit = 28;
    render();
  }
}

async function chooseYear(year) {
  if (state.loading) return;
  try {
    if (year !== "all") {
      setLoading(true, `正在读取 ${year} 年资料…`);
      await getYear(Number(year));
    }
    state.activeYear = year;
    state.visibleLimit = 28;
    render();
  } catch (error) {
    console.error(error);
    $("#dataStatus").textContent = "该年份资料读取失败";
  } finally {
    setLoading(false);
  }
}

function selectedPosts() {
  let posts = [...state.posts];
  if (state.activeAuthor !== "all") posts = posts.filter((post) => post.author === state.activeAuthor);
  if (state.activeYear !== "all") posts = posts.filter((post) => dateFrom(post).getFullYear() === Number(state.activeYear));
  if (state.activeType === "original") posts = posts.filter((post) => !post.isRepost);
  if (state.activeType === "repost") posts = posts.filter((post) => post.isRepost);
  if (state.activeType === "long") posts = posts.filter((post) => post.isLongText);
  if (state.activeType === "media") posts = posts.filter((post) => post.mediaCount > 0);
  if (state.query.trim()) {
    const query = state.query.trim().toLocaleLowerCase();
    posts = posts.filter((post) => [post.text, post.repostText, post.source, post.author, post.repostAuthor].join(" ").toLocaleLowerCase().includes(query));
  }
  if (state.sort === "old") posts.sort((a, b) => a.timestamp - b.timestamp);
  else if (state.sort === "hot") posts.sort((a, b) => (b.likes + b.comments + b.reposts) - (a.likes + a.comments + a.reposts));
  else posts.sort((a, b) => b.timestamp - a.timestamp);
  return posts;
}

function card(post) {
  const badges = [post.isPinned ? '<span class="post-badge hot">置顶</span>' : "", post.isLongText ? '<span class="post-badge">长文</span>' : "", post.mediaCount ? `<span class="post-badge">媒体 ${post.mediaCount}</span>` : ""].filter(Boolean).join("");
  const repost = post.isRepost && post.repostText ? `<blockquote class="repost-context"><b>@${escapeHtml(post.repostAuthor || "原微博")}</b>　${escapeHtml(post.repostText)}</blockquote>` : "";
  const contentClass = post.text.length > 600 ? "post-text is-long" : "post-text";
  return `<article class="post-card ${post.isPinned ? "is-pinned" : ""}" data-post-id="${escapeHtml(post.id)}">
    <div class="post-meta"><span class="post-author">${escapeHtml(post.author)}</span><span class="meta-separator">/</span><time>${escapeHtml(dateShortFormatter.format(dateFrom(post)))}</time>${post.source ? `<span class="meta-separator">·</span><span>${escapeHtml(post.source)}</span>` : ""}<span class="post-badges">${badges}</span></div>
    <p class="${contentClass}">${escapeHtml(post.text)}</p>${repost}
    <footer class="post-footer"><span>转发 ${number(post.reposts)}</span><span>评论 ${number(post.comments)}</span><span>赞 ${number(post.likes)}</span><button class="detail-button" type="button" data-detail-id="${escapeHtml(post.id)}">展开阅读</button></footer>
  </article>`;
}

function renderPosts(posts) {
  const displayed = posts.slice(0, state.visibleLimit);
  let previousDay = "";
  const feed = $("#postFeed");
  feed.innerHTML = displayed.map((post) => {
    const key = dayKey(post);
    const divider = key === previousDay ? "" : `<div class="date-divider"><b>${escapeHtml(dateFormatter.format(dateFrom(post)))}</b><span>${escapeHtml(String(dateFrom(post).getFullYear()))}</span></div>`;
    previousDay = key;
    return divider + card(post);
  }).join("");
  $$("[data-detail-id]").forEach((button) => button.addEventListener("click", () => openDetail(button.dataset.detailId)));
}

function renderFilters() {
  const authorItems = [{ name: "全部博主", count: state.index.stats.total, avatar: "", value: "all" }, ...state.index.authors.map((author) => ({ ...author, value: author.name }))];
  $("#authorFilters").innerHTML = authorItems.map((author) => `<button type="button" class="author-filter ${state.activeAuthor === author.value ? "is-active" : ""}" data-author="${escapeHtml(author.value)}"><span class="filter-avatar">${initials(author.name)}${author.avatar ? `<img src="${escapeHtml(author.avatar)}" alt="" onerror="this.remove()" />` : ""}</span><span class="filter-name">${escapeHtml(author.name)}</span><span class="filter-count">${number(author.count)}</span></button>`).join("");
  $$("[data-author]").forEach((button) => button.addEventListener("click", async () => {
    state.activeAuthor = button.dataset.author;
    state.visibleLimit = 28;
    if (state.activeAuthor !== "all" && state.loadedYears.size !== state.index.years.length) await loadAllArchive();
    render();
  }));

  const yearItems = [{ value: "all", count: state.index.stats.total, label: "所有已载入" }, ...state.index.years];
  $("#yearFilters").innerHTML = yearItems.map((year) => `<button type="button" class="year-filter ${String(state.activeYear) === String(year.value) ? "is-active" : ""}" data-year="${year.value}"><span>${escapeHtml(String(year.label || year.value))}</span><span class="filter-count">${number(year.count)}</span></button>`).join("");
  $$("[data-year]").forEach((button) => button.addEventListener("click", () => chooseYear(button.dataset.year)));
}

function updateSummary(posts) {
  const loaded = state.posts.length;
  $("#totalPosts").textContent = number(state.index.stats.total);
  $("#visiblePosts").textContent = number(posts.length);
  $("#mediaPosts").textContent = number(posts.filter((post) => post.mediaCount > 0).length);
  $("#longPosts").textContent = number(posts.filter((post) => post.isLongText).length);
  $("#loadedProgress").textContent = `已载入 ${number(loaded)} / ${number(state.index.stats.total)} 条`;
  $("#loadAllCount").textContent = state.loadedYears.size === state.index.years.length ? "已完成" : `+${number(state.index.stats.total - loaded)}`;
  $("#dataStatus").textContent = state.loadedYears.size === state.index.years.length ? "完整资料已就绪" : `已载入 ${number(loaded)} 条`;
}

function updateHeader(posts) {
  const authorTitle = state.activeAuthor === "all" ? "微博资料流" : `@${state.activeAuthor}`;
  const yearTitle = state.activeYear === "all" ? "最新资料" : `${state.activeYear} 年资料`;
  $("#readerTitle").textContent = state.query ? `“${state.query}”` : state.activeAuthor === "all" ? yearTitle : authorTitle;
  $("#resultCaption").textContent = state.query ? "SEARCH RESULTS" : state.activeYear === "all" ? "LATEST ENTRIES" : `ARCHIVE / ${state.activeYear}`;
  const globalRange = `${new Date(state.index.stats.earliestTimestamp).getFullYear()} — ${new Date(state.index.stats.latestTimestamp).getFullYear()} · ${number(state.index.stats.total)} 条资料`;
  $("#archiveRange").textContent = globalRange;
  $("#moreButton").hidden = posts.length <= state.visibleLimit;
}

function render() {
  if (!state.index) return;
  const posts = selectedPosts();
  renderFilters();
  renderPosts(posts);
  updateSummary(posts);
  updateHeader(posts);
  $("#emptyState").hidden = posts.length > 0;
  $("#postFeed").hidden = posts.length === 0;
}

function openDetail(postId) {
  const post = state.posts.find((item) => item.id === postId);
  if (!post) return;
  $("#dialogMeta").textContent = `${post.author.toUpperCase()} / ${dateFormatter.format(dateFrom(post))}`;
  $("#dialogTitle").textContent = post.isRepost ? "转发微博" : "微博详情";
  $("#dialogContent").innerHTML = `<div>${escapeHtml(post.text)}</div>${post.isRepost && post.repostText ? `<div class="dialog-repost"><b>@${escapeHtml(post.repostAuthor || "原微博")}</b><br />${escapeHtml(post.repostText)}</div>` : ""}`;
  $("#sourceLink").href = post.url;
  $("#postDialog").showModal();
}

function bindInterface() {
  $("#loadAllButton").addEventListener("click", loadAllArchive);
  $("#moreButton").addEventListener("click", () => { state.visibleLimit += 28; render(); });
  $("#clearSearch").addEventListener("click", () => { $("#searchInput").value = ""; state.query = ""; state.visibleLimit = 28; render(); });
  $("#searchInput").addEventListener("input", (event) => { state.query = event.target.value; state.visibleLimit = 28; render(); });
  $("#sortSelect").addEventListener("change", (event) => { state.sort = event.target.value; state.visibleLimit = 28; render(); });
  $$("[data-type]").forEach((button) => button.addEventListener("click", () => { state.activeType = button.dataset.type; state.visibleLimit = 28; $$("[data-type]").forEach((item) => item.classList.toggle("is-active", item === button)); render(); }));
  $("#themeToggle").addEventListener("click", () => { document.body.classList.toggle("dark"); localStorage.setItem("weibo-reader-theme", document.body.classList.contains("dark") ? "dark" : "light"); });
  $("#dialogClose").addEventListener("click", () => $("#postDialog").close());
  $("#postDialog").addEventListener("click", (event) => { if (event.target === $("#postDialog")) $("#postDialog").close(); });
  window.addEventListener("keydown", (event) => { if (event.key === "/" && document.activeElement?.tagName !== "INPUT") { event.preventDefault(); $("#searchInput").focus(); } });
}

async function initialise() {
  try {
    const response = await fetch("reader-data/weibo-index.json");
    if (!response.ok) throw new Error("资料索引不可用");
    state.index = await response.json();
    state.posts = state.index.initialPosts || [];
    const latestYear = new Date(state.index.stats.latestTimestamp).getFullYear();
    state.loadedYears.add(latestYear);
    if (localStorage.getItem("weibo-reader-theme") === "dark") document.body.classList.add("dark");
    bindInterface();
    render();
  } catch (error) {
    console.error(error);
    $("#dataStatus").textContent = "资料索引未找到";
    $("#postFeed").innerHTML = `<div class="empty-state"><span class="empty-mark">!</span><h3>无法读取本地资料。</h3><p>请在本目录运行本地服务后，再通过浏览器访问页面。</p></div>`;
  }
}

initialise();
