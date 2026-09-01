// Copyright Thales 2026
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { useState } from "react";

interface QuizQuestion {
  question: string;
  choices: { A: string; B: string; C: string; D: string };
  correct_answer: string;
  explanation: string;
  source_reference: string;
}

interface QuizBlockProps {
  quiz_id: string;
  title?: string;
  questions: QuizQuestion[];
}

const CHOICE_KEYS = ["A", "B", "C", "D"] as const;

export function QuizBlock({ questions, title }: QuizBlockProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [userAnswers, setUserAnswers] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);

  const total = questions.length;
  const score = userAnswers.filter((ans, i) => ans === questions[i]?.correct_answer).length;

  function handleAnswer(choice: string) {
    if (selectedAnswer !== null) return;
    setSelectedAnswer(choice);
    setUserAnswers((prev) => [...prev, choice]);
  }

  function handleNext() {
    if (currentIndex + 1 >= total) {
      setFinished(true);
    } else {
      setCurrentIndex((i) => i + 1);
      setSelectedAnswer(null);
    }
  }

  function handleRestart() {
    setCurrentIndex(0);
    setSelectedAnswer(null);
    setUserAnswers([]);
    setFinished(false);
  }

  const container: React.CSSProperties = {
    border: "1px solid var(--outline-variant)",
    borderRadius: "8px",
    padding: "20px",
    backgroundColor: "var(--surface-container)",
    color: "var(--on-surface)",
    maxWidth: "680px",
    fontFamily: "inherit",
    boxSizing: "border-box",
  };

  // ── Écran final ──────────────────────────────────────────────────────────
  if (finished) {
    const wrongQuestions = questions
      .map((q, i) => ({ q, i, userAnswer: userAnswers[i] }))
      .filter(({ q, userAnswer }) => userAnswer !== q.correct_answer);

    return (
      <div style={container}>
        {title && (
          <p style={{ margin: "0 0 4px", fontSize: "0.75rem", color: "var(--on-surface-muted)" }}>
            {title}
          </p>
        )}
        <p style={{ margin: "0 0 16px", fontWeight: 600, fontSize: "1rem" }}>
          Score final : {score} / {total}
        </p>

        {/* Récapitulatif rapide */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "20px" }}>
          {questions.map((q, i) => {
            const correct = userAnswers[i] === q.correct_answer;
            return (
              <div
                key={i}
                style={{
                  padding: "10px 12px",
                  borderRadius: "6px",
                  backgroundColor: correct ? "var(--success-container)" : "var(--error-container)",
                  color: correct ? "var(--on-success-container)" : "var(--on-error-container)",
                  fontSize: "0.8125rem",
                  lineHeight: "1.5",
                }}
              >
                <span style={{ fontWeight: 600 }}>Q{i + 1}. </span>
                {q.question}
                <br />
                <span style={{ opacity: 0.85 }}>
                  Réponse : {userAnswers[i]}
                  {!correct && ` — correct : ${q.correct_answer}`}
                </span>
              </div>
            );
          })}
        </div>

        {/* Points à revoir */}
        {wrongQuestions.length > 0 && (
          <div style={{ marginBottom: "20px" }}>
            <p style={{ margin: "0 0 10px", fontWeight: 600, fontSize: "0.875rem", color: "var(--on-surface)" }}>
              Points à revoir ({wrongQuestions.length})
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {wrongQuestions.map(({ q, i }) => (
                <div
                  key={i}
                  style={{
                    padding: "12px 14px",
                    borderRadius: "6px",
                    border: "1px solid var(--outline-variant)",
                    backgroundColor: "var(--surface-container-high)",
                    fontSize: "0.8125rem",
                    lineHeight: "1.55",
                  }}
                >
                  <p style={{ margin: "0 0 6px", fontWeight: 600, color: "var(--on-surface)" }}>
                    Q{i + 1}. {q.question}
                  </p>
                  <p style={{ margin: "0 0 4px", color: "var(--on-surface)" }}>
                    <span style={{ fontWeight: 500 }}>Bonne réponse : </span>
                    {q.correct_answer}. {q.choices[q.correct_answer as keyof typeof q.choices]}
                  </p>
                  <p style={{ margin: "0 0 4px", color: "var(--on-surface-retreat)" }}>
                    {q.explanation}
                  </p>
                  {q.source_reference && (
                    <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--on-surface-muted)", fontStyle: "italic" }}>
                      {q.source_reference}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={handleRestart}
          style={{
            padding: "8px 16px",
            borderRadius: "6px",
            border: "1px solid var(--outline-variant)",
            backgroundColor: "var(--primary-container)",
            color: "var(--on-primary-container)",
            cursor: "pointer",
            fontSize: "0.875rem",
            fontWeight: 500,
            fontFamily: "inherit",
          }}
        >
          Recommencer
        </button>
      </div>
    );
  }

  // ── Question en cours ─────────────────────────────────────────────────────
  const q = questions[currentIndex];
  const answered = selectedAnswer !== null;
  const isCorrect = selectedAnswer === q.correct_answer;

  return (
    <div style={container}>
      {title && (
        <p style={{ margin: "0 0 12px", fontSize: "0.75rem", color: "var(--on-surface-muted)" }}>
          {title}
        </p>
      )}

      {/* Barre de progression */}
      <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "16px" }}>
        {questions.map((_, i) => (
          <div
            key={i}
            style={{
              height: "6px",
              borderRadius: "3px",
              backgroundColor: i <= currentIndex ? "var(--primary)" : "var(--outline-variant)",
              width: i === currentIndex ? "18px" : "6px",
              transition: "width 0.2s ease, background-color 0.2s ease",
            }}
          />
        ))}
        <span style={{ marginLeft: "8px", fontSize: "0.75rem", color: "var(--on-surface-muted)" }}>
          {currentIndex + 1} / {total}
        </span>
      </div>

      {/* Texte de la question */}
      <p style={{ margin: "0 0 16px", fontWeight: 500, lineHeight: "1.55", fontSize: "0.9375rem" }}>
        {q.question}
      </p>

      {/* Boutons de choix */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
        {CHOICE_KEYS.map((key) => {
          let bg = "var(--surface-container-high)";
          let borderColor = "var(--outline-variant)";
          let color = "var(--on-surface)";

          if (answered) {
            if (key === q.correct_answer) {
              bg = "var(--success-container)";
              borderColor = "var(--success)";
              color = "var(--on-success-container)";
            } else if (key === selectedAnswer) {
              bg = "var(--error-container)";
              borderColor = "var(--error)";
              color = "var(--on-error-container)";
            }
          }

          return (
            <button
              key={key}
              onClick={() => handleAnswer(key)}
              disabled={answered}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
                padding: "10px 14px",
                borderRadius: "6px",
                border: `1px solid ${borderColor}`,
                backgroundColor: bg,
                color,
                cursor: answered ? "default" : "pointer",
                textAlign: "left",
                fontSize: "0.875rem",
                lineHeight: "1.5",
                fontFamily: "inherit",
                transition: "background-color 0.15s ease, border-color 0.15s ease",
                width: "100%",
              }}
            >
              <span style={{ fontWeight: 600, minWidth: "18px", flexShrink: 0 }}>{key}.</span>
              <span>{q.choices[key]}</span>
            </button>
          );
        })}
      </div>

      {/* Feedback après réponse */}
      {answered && (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: "6px",
            backgroundColor: isCorrect ? "var(--success-container)" : "var(--error-container)",
            color: isCorrect ? "var(--on-success-container)" : "var(--on-error-container)",
            marginBottom: "14px",
            fontSize: "0.875rem",
            lineHeight: "1.55",
          }}
        >
          <p style={{ margin: "0 0 4px", fontWeight: 600 }}>
            {isCorrect ? "Correct !" : `Incorrect — bonne réponse : ${q.correct_answer}`}
          </p>
          <p style={{ margin: "0 0 6px" }}>{q.explanation}</p>
          {q.source_reference && (
            <p style={{ margin: 0, fontSize: "0.75rem", opacity: 0.8 }}>
              Source : {q.source_reference}
            </p>
          )}
        </div>
      )}

      {/* Bouton suivant */}
      {answered && (
        <button
          onClick={handleNext}
          style={{
            padding: "8px 18px",
            borderRadius: "6px",
            border: "none",
            backgroundColor: "var(--primary)",
            color: "var(--on-primary)",
            cursor: "pointer",
            fontSize: "0.875rem",
            fontWeight: 500,
            fontFamily: "inherit",
          }}
        >
          {currentIndex + 1 >= total ? "Voir le score" : "Question suivante →"}
        </button>
      )}
    </div>
  );
}
