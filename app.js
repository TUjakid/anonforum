import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendPasswordResetEmail, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase, ref, get, set, update, push, onValue, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

/* ====================== константы ====================== */
const ID_LEN = 8;
const BRANCHES = [
  { code: "A", title: "Анонсы и правила" },
  { code: "B", title: "Random / Со всего форума" },
  { code: "C", title: "Творчество" },
  { code: "D", title: "Дизайн" },
  { code: "DIY", title: "«Сделай сам»" },
  { code: "T", title: "Технологии" },
  { code: "Q", title: "Вопросы и помощь" },
  { code: "G", title: "Игры" },
  { code: "M", title: "Военная ветка" },
  { code: "MU", title: "Музыка" },
  { code: "MEM", title: "Анекдоты/Шутки" },
  { code: "META", title: "Проблемы и баги форума" },
  { code: "S", title: "Спорт" },
  { code: "PROG", title: "Программирование" },
  { code: "F", title: "Кино и сериалы" },
  { code: "FIN", title: "Экономика и финансы" },
  { code: "L", title: "Литература" },
  { code: "LANG", title: "Языки" },
  { code: "AN", title: "Аниме/Манга" },
  { code: "R", title: "Отношения" },
  { code: "H", title: "Здоровье" },
  { code: "W", title: "Работа и вакансии" }
];
const BRANCH_CODES = BRANCHES.map(b => b.code);

/* ====================== настройки «рандомной» ветки B ====================== */
const RANDOM_BRANCH = "B";
const RANDOM_COUNT = 5;

let bSeed = null;
let bShowAll = false;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

/* ====================== утилиты ====================== */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nl2br = (s) => esc(s).replace(/\n/g, "<br>");
const fmt = (ts) => {
  try { return new Date(ts).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }); }
  catch { return "—"; }
};
const randId = () => Array.from({ length: ID_LEN }, () => Math.floor(Math.random() * 10)).join("");
const newKey = (path) => push(ref(db, path)).key;

/* ====================== состояние ====================== */
let me = null;
let profilePromise = null;
let unsub = null;

function clearSub() { if (unsub) { unsub(); unsub = null; } }

/* ====================== профиль и ID ====================== */
async function ensureProfile(user) {
  const uref = ref(db, `users/${user.uid}`);
  const snap = await get(uref);
  if (snap.exists()) return snap.val();

  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = randId();
    const res = await runTransaction(ref(db, `accountIds/${candidate}`), (cur) => {
      if (cur === null) return user.uid;
      return;
    });
    if (!res.committed) continue;

    const profile = {
      accountId: candidate,
      displayName: `user-${candidate.slice(-4)}`,
      createdAt: Date.now()
    };
    await set(uref, profile);
    return profile;
  }
  throw new Error("Не удалось выдать ID. Попробуйте войти ещё раз.");
}

async function loadMe(user) {
  if (!profilePromise) {
    profilePromise = (async () => {
      const profile = await ensureProfile(user);
      return { uid: user.uid, profile };
    })();
  }
  try {
    return await profilePromise;
  } catch (e) {
    profilePromise = null;
    throw e;
  }
}

async function loadNames(uids) {
  const uniq = [...new Set(uids.filter(Boolean))];
  const out = {};
  await Promise.all(uniq.map(async (uid) => {
    try {
      const s = await get(ref(db, `users/${uid}`));
      out[uid] = s.exists() ? s.val().displayName : null;
    } catch { out[uid] = null; }
  }));
  return out;
}

/* ====================== auth-ошибки ====================== */
function authError(err) {
  const map = {
    "auth/invalid-email": "Некорректный email.",
    "auth/missing-password": "Введите пароль.",
    "auth/weak-password": "Пароль слишком короткий (минимум 6 символов).",
    "auth/email-already-in-use": "Этот email уже занят.",
    "auth/invalid-credential": "Неверный email или пароль.",
    "auth/wrong-password": "Неверный пароль.",
    "auth/user-not-found": "Пользователь не найден.",
    "auth/too-many-requests": "Слишком много попыток. Подождите немного.",
    "auth/operation-not-allowed": "В Firebase не включён вход по email/паролю.",
    "auth/unauthorized-domain": "Домен не добавлен в Authorized domains в Firebase.",
    "auth/configuration-not-found": "В Firebase не настроен вход по email/паролю (Authentication → Sign-in method)."
  };
  return map[err?.code] || err?.message || String(err);
}

/* ====================== общий хедер ====================== */
function header(activeCode) {
  return `
    <header class="top">
      <a class="brand" href="#/">Board</a>
      <nav>
        ${BRANCHES.map(b => `<a href="#/${b.code}" class="${activeCode === b.code ? "active" : ""}" title="${esc(b.title)}">${b.code}</a>`).join("")}
      </nav>
      <div class="me">
        <a href="#/profile">${esc(me.profile.displayName)}</a>
        <span class="id">#${me.profile.accountId}</span>
        <button id="logout" class="link" type="button">выйти</button>
      </div>
    </header>`;
}

function wireHeader() {
  const btn = $("logout");
  if (btn) btn.onclick = () => signOut(auth);
}

/* ====================== экран входа ====================== */
function renderAuth(errorMsg = "") {
  $("app").innerHTML = `
    <div class="auth">
      <h1>Board</h1>
      <p class="muted">Анонимная доска. Аккаунт нужен только для ID и имени — email нигде не публикуется.</p>
      <form id="authForm">
        <label>Email
          <input type="email" id="email" autocomplete="email" required>
        </label>
        <label>Пароль
          <input type="password" id="pass" autocomplete="current-password" minlength="6" required>
        </label>
        <div class="row">
          <button type="submit" name="mode" value="login">Войти</button>
          <button type="submit" name="mode" value="signup" class="secondary">Регистрация</button>
        </div>
      </form>
      <p><a href="#" id="reset">Забыли пароль?</a></p>
      <p class="error" id="err">${esc(errorMsg)}</p>
    </div>`;

  $("authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const mode = e.submitter?.value || "login";
    const email = $("email").value.trim();
    const pass = $("pass").value;
    $("err").textContent = "";
    try {
      if (mode === "signup") await createUserWithEmailAndPassword(auth, email, pass);
      else await signInWithEmailAndPassword(auth, email, pass);
    } catch (err) {
      $("err").textContent = authError(err);
    }
  });

  $("reset").addEventListener("click", async (e) => {
    e.preventDefault();
    const email = $("email").value.trim();
    if (!email) { $("err").textContent = "Сначала введите email."; return; }
    try {
      await sendPasswordResetEmail(auth, email);
      $("err").textContent = "Письмо для сброса пароля отправлено.";
    } catch (err) {
      $("err").textContent = authError(err);
    }
  });
}

/* ====================== главная ====================== */
function renderHome() {
  $("app").innerHTML = header("") + `
    <main>
      <h1>Ветки</h1>
      <ul class="branches">
        ${BRANCHES.map(b => `
          <li>
            <a href="#/${b.code}"><b>${b.code}</b> — ${esc(b.title)}</a>
            <div class="muted" id="cnt-${b.code}">…</div>
          </li>`).join("")}
      </ul>
    </main>`;
  wireHeader();

  BRANCHES.forEach(async (b) => {
    if (b.code === RANDOM_BRANCH) {
      const el = $(`cnt-${b.code}`);
      if (el) el.textContent = "случайные треды со всего форума";
      return;
    }
    try {
      const s = await get(ref(db, `forum/branches/${b.code}/threads`));
      const n = s.exists() ? Object.keys(s.val()).length : 0;
      const el = $(`cnt-${b.code}`);
      if (el) el.textContent = n === 1 ? "1 тред" : `${n} тредов`;
    } catch { /* игнорируем */ }
  });
}

/* ====================== ветка ====================== */
function renderBranch(code) {
  const b = BRANCHES.find(x => x.code === code);
  const isRandom = code === RANDOM_BRANCH;

  if (isRandom) { bSeed = null; bShowAll = false; }

  $("app").innerHTML = header(code) + `
    <main>
      <h1>${code} — ${esc(b.title)}</h1>
      ${isRandom ? `
        <div class="branch-toolbar">
          <span class="muted" id="bCount"></span>
          <button type="button" id="bRefresh" class="secondary">Обновить выбор</button>
          <button type="button" id="bAll" class="secondary">Показать все</button>
        </div>` : `
        <details class="new-thread">
          <summary>Создать тред</summary>
          <form id="newThread">
            <input id="tTitle" placeholder="Заголовок" maxlength="120" required>
            <textarea id="tText" placeholder="Текст первого поста" maxlength="5000" required></textarea>
            <button type="submit">Опубликовать</button>
            <span class="error" id="tErr"></span>
          </form>
        </details>`}
      <div id="threads" class="threads"><p class="muted">Загрузка…</p></div>
    </main>`;
  wireHeader();

  if (isRandom) {
    renderRandomAll();
    return;
  }

  // обычная ветка
  $("newThread").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("tErr").textContent = "";
    const title = $("tTitle").value.trim();
    const text = $("tText").value.trim();
    if (!title || !text) { $("tErr").textContent = "Заполните заголовок и текст."; return; }
    try {
      const tRef = push(ref(db, `forum/branches/${code}/threads`));
      const pKey = newKey(`forum/branches/${code}/threads/${tRef.key}/posts`);
      const now = Date.now();
      await set(tRef, {
        title,
        authorUid: me.uid,
        authorId: me.profile.accountId,
        createdAt: now,
        lastPostAt: now,
        postCount: 1,
        posts: {
          [pKey]: {
            text,
            authorUid: me.uid,
            authorId: me.profile.accountId,
            createdAt: now
          }
        }
      });
      location.hash = `#/${code}/${tRef.key}`;
    } catch (err) {
      $("tErr").textContent = err.message;
    }
  });

  unsub = onValue(ref(db, `forum/branches/${code}/threads`), (snap) => {
    renderRegularList(code, snap.val() || {});
  });
}

/* ====================== B: рандом со всего форума ====================== */
function renderRandomAll() {
  let pool = [];

  const draw = async () => {
    const box = $("threads");
    if (!box) return;

    if (!pool.length) {
      box.innerHTML = `<p class="muted">Пока пусто. Создайте тред в любой ветке — и он попадёт в рандом.</p>`;
      if ($("bCount")) $("bCount").textContent = "";
      return;
    }

    const sorted = pool.slice().sort((a, b) => (b.t.lastPostAt || 0) - (a.t.lastPostAt || 0));
    const ids = sorted.map(x => x.key);
    const map = new Map(sorted.map(x => [x.key, x]));

    let shown;
    if (bShowAll) {
      shown = sorted;
      if ($("bCount")) $("bCount").textContent = `Все треды со всего форума: ${sorted.length}`;
    } else if (sorted.length > RANDOM_COUNT) {
      if (!bSeed) bSeed = shuffle(ids);
      for (const id of ids) if (!bSeed.includes(id)) bSeed.push(id);
      bSeed = bSeed.filter(id => ids.includes(id));

      shown = bSeed.slice(0, RANDOM_COUNT).map(id => map.get(id)).filter(Boolean);
      if ($("bCount")) $("bCount").textContent = `Случайные ${shown.length} из ${sorted.length} со всего форума`;
    } else {
      shown = sorted;
      if ($("bCount")) $("bCount").textContent = `Все треды: ${sorted.length} (мало для рандома)`;
    }

    const names = await loadNames(shown.map(x => x.t.authorUid));
    box.innerHTML = shown.map(x => `
      <article class="thread-row">
        <a class="title" href="#/${x.branch}/${x.tid}">${esc(x.t.title)}</a>
        <div class="muted">
          <span class="id">${esc(x.branch)}</span>
          · ${esc(names[x.t.authorUid] || "—")} <span class="id">#${esc(x.t.authorId)}</span>
          · ${fmt(x.t.createdAt)}
          · ответов: ${Math.max(0, (x.t.postCount || 1) - 1)}
        </div>
      </article>`).join("");
  };

  $("bRefresh").addEventListener("click", () => {
    bSeed = null;
    draw();
  });
  $("bAll").addEventListener("click", () => {
    bShowAll = !bShowAll;
    $("bAll").textContent = bShowAll ? "Свернуть в рандом" : "Показать все";
    draw();
  });

  unsub = onValue(ref(db, "forum/branches"), (snap) => {
    const branches = snap.val() || {};
    pool = [];
    for (const [bcode, br] of Object.entries(branches)) {
      const threads = br.threads || {};
      for (const [tid, t] of Object.entries(threads)) {
        pool.push({
          key: `${bcode}/${tid}`,
          branch: bcode,
          tid,
          t
        });
      }
    }
    draw();
  });
}

/* ====================== обычный список тредов ====================== */
async function renderRegularList(code, threads) {
  const box = $("threads");
  if (!box) return;

  const entries = Object.entries(threads)
    .sort((a, b) => (b[1].lastPostAt || 0) - (a[1].lastPostAt || 0));

  if (!entries.length) {
    box.innerHTML = `<p class="muted">Пока пусто. Создайте первый тред.</p>`;
    return;
  }

  const names = await loadNames(entries.map(([, t]) => t.authorUid));
  box.innerHTML = entries.map(([tid, t]) => `
    <article class="thread-row">
      <a class="title" href="#/${code}/${tid}">${esc(t.title)}</a>
      <div class="muted">
        ${esc(names[t.authorUid] || "—")} <span class="id">#${esc(t.authorId)}</span>
        · ${fmt(t.createdAt)}
        · ответов: ${Math.max(0, (t.postCount || 1) - 1)}
      </div>
    </article>`).join("");
}

/* ====================== тред ====================== */
function renderThread(code, tid) {
  $("app").innerHTML = header(code) + `
    <main>
      <p><a href="#/${code}">← к ветке ${code}</a></p>
      <h1 class="thread-title" id="tTitleEl">…</h1>
      <div id="posts" class="posts"><p class="muted">Загрузка…</p></div>
      <form id="reply" class="reply">
        <textarea id="rText" placeholder="Ответ" maxlength="5000" required></textarea>
        <button type="submit">Отправить</button>
        <span class="error" id="rErr"></span>
      </form>
    </main>`;
  wireHeader();

  let lastCount = 0;

  $("reply").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("rErr").textContent = "";
    const text = $("rText").value.trim();
    if (!text) return;
    try {
      const pKey = newKey(`forum/branches/${code}/threads/${tid}/posts`);
      const now = Date.now();
      await update(ref(db, `forum/branches/${code}/threads/${tid}`), {
        [`posts/${pKey}`]: {
          text,
          authorUid: me.uid,
          authorId: me.profile.accountId,
          createdAt: now
        },
        lastPostAt: now,
        postCount: lastCount + 1
      });
      $("rText").value = "";
    } catch (err) {
      $("rErr").textContent = err.message;
    }
  });

  unsub = onValue(ref(db, `forum/branches/${code}/threads/${tid}`), async (snap) => {
    const t = snap.val();
    const box = $("posts");
    if (!box) return;

    if (!t) {
      $("tTitleEl").textContent = "Тред не найден";
      box.innerHTML = `<p class="error">Тред не существует или был удалён.</p>`;
      return;
    }

    $("tTitleEl").textContent = t.title;
    document.title = `${t.title} — Board`;

    const posts = Object.entries(t.posts || {})
      .sort((a, b) => a[1].createdAt - b[1].createdAt);
    lastCount = t.postCount || posts.length;

    const names = await loadNames(posts.map(([, p]) => p.authorUid));

    box.innerHTML = posts.map(([, p], i) => `
      <article class="post ${i === 0 ? "op" : ""}">
        <div class="meta">
          <b>${esc(names[p.authorUid] || "—")}</b>
          <span class="id">#${esc(p.authorId)}</span>
          <span class="muted">${fmt(p.createdAt)}</span>
          ${i === 0 ? `<span class="tag">OP</span>` : ""}
        </div>
        <div class="text">${nl2br(p.text)}</div>
      </article>`).join("");
  });
}

/* ====================== профиль ====================== */
function renderProfile() {
  $("app").innerHTML = header("") + `
    <main>
      <h1>Профиль</h1>
      <p>ID: <span class="id">#${me.profile.accountId}</span></p>
      <form id="rename" class="rename">
        <label>Имя
          <input id="name" minlength="2" maxlength="32" value="${esc(me.profile.displayName)}" required>
        </label>
        <button type="submit">Сохранить</button>
        <span class="error" id="nErr"></span>
      </form>
      <h2>Мои треды</h2>
      <div id="myThreads" class="muted">Загрузка…</div>
      <h2>Мои посты</h2>
      <div id="myPosts" class="muted">Загрузка…</div>
    </main>`;
  wireHeader();

  $("rename").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("name").value.trim();
    if (name.length < 2 || name.length > 32) {
      $("nErr").textContent = "Имя должно быть от 2 до 32 символов.";
      return;
    }
    try {
      await update(ref(db, `users/${me.uid}`), { displayName: name });
      me.profile.displayName = name;
      renderProfile();
    } catch (err) {
      $("nErr").textContent = err.message;
    }
  });

  (async () => {
    try {
      const snap = await get(ref(db, "forum/branches"));
      const branches = snap.val() || {};
      const threads = [], posts = [];

      for (const [code, b] of Object.entries(branches)) {
        for (const [tid, t] of Object.entries(b.threads || {})) {
          if (t.authorUid === me.uid) {
            threads.push({ code, tid, title: t.title, at: t.createdAt });
          }
          for (const [pid, p] of Object.entries(t.posts || {})) {
            if (p.authorUid === me.uid) {
              posts.push({ code, tid, pid, title: t.title, at: p.createdAt, text: p.text });
            }
          }
        }
      }
      threads.sort((a, b) => b.at - a.at);
      posts.sort((a, b) => b.at - a.at);

      const tEl = $("myThreads"), pEl = $("myPosts");
      if (!tEl || !pEl) return;

      tEl.className = "";
      tEl.innerHTML = threads.length
        ? `<ul>${threads.map(x => `
            <li><a href="#/${x.code}/${x.tid}">${esc(x.title)}</a>
            <span class="muted">${x.code} · ${fmt(x.at)}</span></li>`).join("")}</ul>`
        : `<p class="muted">Пока нет.</p>`;

      pEl.className = "";
      pEl.innerHTML = posts.length
        ? `<ul>${posts.slice(0, 200).map(x => `
            <li><a href="#/${x.code}/${x.tid}">${esc(x.title)}</a>
            <span class="muted">${x.code} · ${fmt(x.at)}</span>
            <div class="snippet">${esc(x.text.slice(0, 140))}</div></li>`).join("")}</ul>`
        : `<p class="muted">Пока нет.</p>`;
    } catch (e) {
      const el = $("myThreads");
      if (el) el.textContent = "Не удалось загрузить: " + e.message;
    }
  })();
}

/* ====================== роутер ====================== */
function route() {
  clearSub();
  if (!me) return renderAuth();

  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts.length === 0) return renderHome();
  if (parts[0] === "profile") return renderProfile();

  const code = parts[0].toUpperCase();
  if (!BRANCH_CODES.includes(code)) {
    $("app").innerHTML = header("") + `
      <main><p class="error">Ветка не найдена. <a href="#/">На главную</a></p></main>`;
    wireHeader();
    return;
  }
  if (parts[1]) return renderThread(code, parts[1]);
  return renderBranch(code);
}

/* ====================== старт ====================== */
onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      me = await loadMe(user);
    } catch (e) {
      me = null;
      renderAuth("Ошибка профиля: " + e.message);
      return;
    }
  } else {
    me = null;
    profilePromise = null;
  }
  route();
});

window.addEventListener("hashchange", () => route());

/* ====================== темы ====================== */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem("theme", t);
  document.querySelectorAll("[data-theme-set]").forEach(b =>
    b.classList.toggle("active", b.dataset.themeSet === t)
  );
}

(function initTheme() {
  const saved = localStorage.getItem("theme") || "graphite";
  document.documentElement.dataset.theme = saved;

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-theme-set]");
    if (!btn) return;
    applyTheme(btn.dataset.themeSet);
  });

  const mark = () => applyTheme(saved);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mark, { once: true });
  } else {
    mark();
  }
})();
