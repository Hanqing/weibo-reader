import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const sourceFiles = [
  { path: "weibo_raw_data/weibo_6827625527_raw.json", uid: "6827625527", name: "t0mbkeeper" },
  { path: "weibo_raw_data/weibo_1401527553_raw.json", uid: "1401527553", name: "tombkeeper" },
];

const normaliseText = (value = "") =>
  value
    .replace(/<br\s*\/?>(\s*)/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const getMediaCount = (item) => {
  const imageCount = Array.isArray(item.pic_ids)
    ? item.pic_ids.length
    : Number(item.pic_num || 0);
  const videoCount = item.page_info?.type === "video" ? 1 : 0;
  return imageCount + videoCount;
};

const toPost = (item, owner) => {
  const itemUser = item.user || {};
  const isForeignAuthor = String(itemUser.idstr || itemUser.id || "") !== owner.uid;
  const user = { id: owner.uid, idstr: owner.uid, screen_name: owner.name };
  const date = new Date(item.created_at);
  const timestamp = Number.isNaN(date.getTime()) ? 0 : date.getTime();
  const mblogid = item.mblogid || item.idstr || String(item.id);
  const repost = item.retweeted_status || (isForeignAuthor ? item : undefined);

  return {
    id: String(item.idstr || item.id),
    uid: String(user.idstr || user.id || ""),
    author: user.screen_name || "未知博主",
    avatar: isForeignAuthor ? "" : itemUser.profile_image_url || "",
    timestamp,
    createdAt: item.created_at || "",
    text: normaliseText(item.text_raw || item.text || ""),
    source: normaliseText(item.source || ""),
    reposts: Number(item.reposts_count || 0),
    comments: Number(item.comments_count || 0),
    likes: Number(item.attitudes_count || 0),
    isPinned: Boolean(item.isTop),
    isRepost: Boolean(item.retweeted_status) || isForeignAuthor,
    isLongText: Boolean(item.isLongText),
    mediaCount: getMediaCount(item),
    repostAuthor: repost?.user?.screen_name || "",
    repostText: normaliseText(repost?.text_raw || repost?.text || "").slice(0, 220),
    url: `https://weibo.com/${user.idstr || user.id || ""}/${mblogid}`,
  };
};

const payloads = sourceFiles.map((source) => ({
  ...source,
  payload: JSON.parse(readFileSync(resolve(process.cwd(), source.path), "utf8")),
}));

const posts = payloads
  .flatMap(({ payload, ...owner }) => payload.items.map((item) => toPost(item, owner)))
  .filter((post) => post.id && post.text)
  .sort((a, b) => b.timestamp - a.timestamp);

const authors = [...new Set(posts.map((post) => post.author))].map((author) => {
  const authorPosts = posts.filter((post) => post.author === author);
  return {
    name: author,
    uid: authorPosts[0]?.uid || "",
    avatar: authorPosts[0]?.avatar || "",
    count: authorPosts.length,
  };
});

const years = [...new Set(posts.map((post) => new Date(post.timestamp).getFullYear()))]
  .filter(Number.isFinite)
  .sort((a, b) => b - a);

const stats = {
  total: posts.length,
  years: years.length,
  withMedia: posts.filter((post) => post.mediaCount > 0).length,
  longPosts: posts.filter((post) => post.isLongText).length,
  original: posts.filter((post) => !post.isRepost).length,
  reposted: posts.filter((post) => post.isRepost).length,
  latestTimestamp: posts[0]?.timestamp || 0,
  earliestTimestamp: posts.at(-1)?.timestamp || 0,
};

const outputDirectory = resolve(process.cwd(), "reader-data");
mkdirSync(outputDirectory, { recursive: true });

for (const year of years) {
  const yearPosts = posts.filter((post) => new Date(post.timestamp).getFullYear() === year);
  writeFileSync(
    resolve(outputDirectory, `weibo-${year}.json`),
    JSON.stringify({ year, posts: yearPosts }),
  );
}

writeFileSync(
  resolve(outputDirectory, "weibo-index.json"),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    authors,
    years: years.map((year) => ({
      value: year,
      count: posts.filter((post) => new Date(post.timestamp).getFullYear() === year).length,
      file: `weibo-${year}.json`,
    })),
    stats,
    initialPosts: posts.slice(0, 260),
  }),
);

console.log(`已生成 ${posts.length} 条阅读器记录，覆盖 ${authors.map((author) => author.name).join("、")}，已按 ${years.length} 个年份拆分。`);
