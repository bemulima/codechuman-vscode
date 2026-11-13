import { useEffect, useMemo, useState } from "react";
import type { ClientRequest, LocalCheckout, LocalDiagnostic, ServerMessage } from "../../src/shared/protocol";

declare function acquireVsCodeApi(): { postMessage(message: ClientRequest): void };

const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : {
  postMessage: (_message: ClientRequest) => undefined,
};

export function App() {
  const [tab, setTab] = useState<"courses" | "teacher">("courses");
  const [entries, setEntries] = useState<LocalCheckout[]>([]);
  const [cliReady, setCliReady] = useState<boolean | null>(null);
  const [gitReady, setGitReady] = useState(false);
  const [authConfigured, setAuthConfigured] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [autoSyncTasks, setAutoSyncTasks] = useState(0);
  const [autoSyncHalted, setAutoSyncHalted] = useState(false);
  const [diagnostic, setDiagnostic] = useState<LocalDiagnostic | null>(null);
  const [material, setMaterial] = useState<{ name: string; content: string } | null>(null);
  const [examples, setExamples] = useState<{ directory: string; names: string[] } | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const handler = (event: MessageEvent<ServerMessage>) => {
      const payload = event.data;
      if (payload.type === "status") {
        setCliReady(payload.cliAvailable);
        setGitReady(payload.git_available);
        if (payload.message) setMessage(payload.message);
      } else if (payload.type === "auth") {
        setAuthConfigured(payload.configured);
        setAuthenticated(payload.connected);
      } else if (payload.type === "sync") {
        setMessage(`Sandbox подтвердил ${payload.action === "created" ? "создание" : "изменение"} файла, ревизия ${payload.revision}.` +
          (payload.mode === "legacy" ? " Legacy-режим: нет защиты от параллельной записи." : ""));
      } else if (payload.type === "auto-sync") {
        setAutoSyncTasks(payload.activeTasks);
        setAutoSyncHalted(payload.halted);
      } else if (payload.type === "courses") {
        setEntries(payload.entries);
      } else if (payload.type === "validation") {
        setDiagnostic(payload.result);
      } else if (payload.type === "material") {
        setMaterial({ name: payload.name, content: payload.content });
      } else if (payload.type === "examples") {
        setExamples({ directory: payload.directory, names: payload.names });
        setMaterial(null);
      } else if (payload.type === "error") {
        setMessage(payload.message);
      }
    };
    window.addEventListener("message", handler);
    vscode.postMessage({ type: "doctor" });
    vscode.postMessage({ type: "list" });
    vscode.postMessage({ type: "auth-status" });
    vscode.postMessage({ type: "auto-sync-status" });
    return () => window.removeEventListener("message", handler);
  }, []);

  const byCourse = useMemo(() => entries.reduce<Record<string, LocalCheckout[]>>((groups, entry) => {
    (groups[entry.manifest.course_slug] ??= []).push(entry);
    return groups;
  }, {}), [entries]);

  return (
    <div className="app">
      <header>
        <div className="brand"><span className="brand-icon">{"</>"}</span><strong>Codechuman</strong></div>
        <span className={cliReady && gitReady ? "pill ready" : "pill"}>{cliReady ? "Local" : "Setup"}</span>
      </header>
      <div className="account">
        <div className="section-title"><strong>Аккаунт Codechuman</strong>
          <small>{authenticated ? "Подключён" : authConfigured ? "Не подключён" : "Не настроен"}</small>
        </div>
        {!authConfigured && <p className="muted">Настрой HTTPS адрес в параметре <code>codechuman.apiBaseUrl</code>.</p>}
        <div className="actions">
          {authenticated ? (
            <>
              <button onClick={() => vscode.postMessage({ type: "checkout-remote" })}>Скачать TaskInstance (preview)</button>
              <button className="secondary" onClick={() => vscode.postMessage({ type: "sync-active" })}>Отправить текущий файл в Sandbox</button>
              <button className="secondary" onClick={() => vscode.postMessage({ type: "auto-sync-enable" })}>Автосинхронизация: включить</button>
              {autoSyncTasks > 0 && <button className="secondary" onClick={() => vscode.postMessage({ type: "auto-sync-disable" })}>Автосинхронизация: выключить</button>}
              <button className="secondary" onClick={() => vscode.postMessage({ type: "sign-out" })}>Выйти</button>
            </>
          ) : (
            <button disabled={!authConfigured} onClick={() => vscode.postMessage({ type: "sign-in" })}>Войти</button>
          )}
        </div>
        {authenticated && <small>Скачивание требует нового Git HTTPS endpoint. Отправка текущего файла использует существующий Sandbox REST; это ручная операция.</small>}
        {authenticated && <small>Автосинхронизация включается отдельно для каждого открытого задания, отправляет изменения через 1 секунду и требует atomic fence. Активных заданий: {autoSyncTasks}.{autoSyncHalted ? " Конфликт: отправка остановлена." : ""}</small>}
      </div>
      <nav>
        <button className={tab === "courses" ? "selected" : ""} onClick={() => setTab("courses")}>Курсы</button>
        <button className={tab === "teacher" ? "selected" : ""} onClick={() => setTab("teacher")}>AI Teacher</button>
      </nav>
      {message && <div className="notice" role="alert">{message}</div>}
      {tab === "courses" ? (
        <section>
          <div className="section-title">
            <h2>Локальные уроки</h2>
            <button className="subtle" onClick={() => vscode.postMessage({ type: "list" })}>Обновить</button>
          </div>
          {entries.length === 0 && <p className="muted">Пока нет скачанных заданий. После подключения курса они появятся здесь.</p>}
          {Object.entries(byCourse).map(([course, lessons]) => (
            <div className="course" key={course}>
              <h3>{course}</h3>
              {lessons?.map((entry) => (
                <div className="lesson" key={entry.manifest.task_instance_id}>
                  <div className="lesson-info">
                    <strong>{String(entry.manifest.lesson_number).padStart(2, "0")}. Урок</strong>
                    <small>{entry.manifest.lesson_revision}</small>
                  </div>
                  <div className="actions">
                    <button onClick={() => vscode.postMessage({ type: "open", directory: entry.directory })}>Открыть</button>
                    <button className="secondary" onClick={() => vscode.postMessage({ type: "validate", directory: entry.directory, file: "app.js" })}>Проверить JS</button>
                    <button className="secondary" onClick={() => vscode.postMessage({ type: "validate-public", directory: entry.directory })}>Публичные тесты</button>
                  </div>
                  <div className="study-actions">
                    <button className="subtle" onClick={() => vscode.postMessage({ type: "read-material", directory: entry.directory, material: "lesson.md" })}>Урок</button>
                    <button className="subtle" onClick={() => vscode.postMessage({ type: "read-material", directory: entry.directory, material: "task.md" })}>Задание</button>
                    <button className="subtle" onClick={() => vscode.postMessage({ type: "read-material", directory: entry.directory, material: "quiz.json" })}>Тест</button>
                    <button className="subtle" onClick={() => vscode.postMessage({ type: "list-examples", directory: entry.directory })}>Примеры</button>
                  </div>
                </div>
              ))}
            </div>
          ))}
          {examples && (
            <div className="material">
              <h3>Локальные примеры</h3>
              {examples.names.length === 0 && <p className="muted">Для этого урока нет сохранённых примеров.</p>}
              {examples.names.map((name) => (
                <button className="example-link" key={name} onClick={() =>
                  vscode.postMessage({ type: "read-material", directory: examples.directory, material: name })
                }>{name}</button>
              ))}
            </div>
          )}
          {material && <div className="material">
            <div className="section-title">
              <h3>{material.name}</h3>
              <button className="subtle" onClick={() => setMaterial(null)}>Закрыть</button>
            </div>
            <pre>{material.content}</pre>
          </div>}
          {diagnostic && <div className={`diagnostic ${diagnostic.status.toLowerCase()}`}>
            <strong>Локальная проверка: {diagnostic.status}</strong>
            {diagnostic.details && <pre>{diagnostic.details}</pre>}
            <small>Не является официальным результатом Practice Runtime.</small>
            <small>Публичные тесты запускают код на вашем компьютере; включайте только для доверенных заданий.</small>
          </div>}
        </section>
      ) : (
        <section className="teacher">
          <div className="teacher-symbol">✳</div>
          <h2>Персональный AI Teacher</h2>
          <p>Диалог подключается к существующим Teacher Agent и Dialog. История и правила обучения останутся на сервере Codechuman.</p>
          <div className="notice">Серверная авторизация и диалог входят в следующий этап интеграции.</div>
        </section>
      )}
      <footer>Локальные проверки работают без AI. Официальный результат выдаёт сервер.</footer>
    </div>
  );
}
