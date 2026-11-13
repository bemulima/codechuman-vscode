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
  const [diagnostic, setDiagnostic] = useState<LocalDiagnostic | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const handler = (event: MessageEvent<ServerMessage>) => {
      const payload = event.data;
      if (payload.type === "status") {
        setCliReady(payload.cliAvailable);
        setGitReady(payload.git_available);
        if (payload.message) setMessage(payload.message);
      } else if (payload.type === "courses") {
        setEntries(payload.entries);
      } else if (payload.type === "validation") {
        setDiagnostic(payload.result);
      } else if (payload.type === "error") {
        setMessage(payload.message);
      }
    };
    window.addEventListener("message", handler);
    vscode.postMessage({ type: "doctor" });
    vscode.postMessage({ type: "list" });
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
                </div>
              ))}
            </div>
          ))}
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
