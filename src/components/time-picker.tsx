"use client";
import { useRef, useState, useCallback } from "react";
const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const minutes = ["00", "15", "30", "45"];
function Wheel({
  values,
  value,
  onChange,
  label,
}: {
  values: string[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const index = Math.max(0, values.indexOf(value));
  function select(next: number) {
    next = Math.max(0, Math.min(values.length - 1, next));
    onChange(values[next]);
    scroll.current?.scrollTo({ top: next * 44, behavior: "instant" });
  }
  const initial = useRef(index);
  const bind = useCallback((element: HTMLDivElement | null) => {
    scroll.current = element;
    if (element) element.scrollTop = initial.current * 44;
  }, []);
  return (
    <div className="time-wheel-column">
      <div className="time-wheel-caption">{label.split("-").at(-1)}</div>
      <div
        className="time-wheel"
        role="listbox"
        aria-label={label.split("-").at(-1)}
        tabIndex={0}
        aria-activedescendant={`${label}-${value}`}
        ref={bind}
        onScroll={(event) => {
          const next = Math.max(
            0,
            Math.min(
              values.length - 1,
              Math.round(event.currentTarget.scrollTop / 44),
            ),
          );
          if (values[next] !== value) onChange(values[next]);
        }}
        onKeyDown={(event) => {
          if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            select(
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? values.length - 1
                  : index + (event.key === "ArrowDown" ? 1 : -1),
            );
          }
        }}
      >
        {values.map((item, i) => (
          <div
            key={item}
            id={`${label}-${item}`}
            role="option"
            aria-selected={value === item}
            className={`time-wheel-option${value === item ? " selected" : ""}`}
            onClick={() => select(i)}
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
export function TimePicker({
  id,
  label,
  value,
  onChange,
  disabled,
  invalid,
  describedBy,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  invalid: boolean;
  describedBy: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const [opening, setOpening] = useState(0);
  const [hour, setHour] = useState("18"),
    [minute, setMinute] = useState("00");
  function close() {
    dialog.current?.close();
    trigger.current?.focus();
  }
  return (
    <>
      <input type="hidden" name={id} value={value} />
      <button
        ref={trigger}
        id={id}
        type="button"
        className="time-picker-trigger"
        disabled={disabled}
        data-invalid={invalid}
        aria-describedby={describedBy}
        aria-haspopup="dialog"
        onClick={() => {
          setOpening((x) => x + 1);
          setHour(value.slice(0, 2) || "18");
          setMinute(
            minutes.includes(value.slice(3, 5)) ? value.slice(3, 5) : "00",
          );
          dialog.current?.showModal();
        }}
      >
        <span>{value || "--:--"}</span>
        <span aria-hidden="true">◷</span>
      </button>
      <dialog
        ref={dialog}
        className="time-picker-dialog"
        aria-label={`Время: ${label}`}
        onCancel={close}
      >
        <h2>{label}</h2>
        <div className="time-wheels">
          <Wheel
            key={`hours-${opening}`}
            values={hours}
            value={hour}
            onChange={setHour}
            label={`${id}-Часы`}
          />
          <span className="time-wheel-colon" aria-hidden="true">
            :
          </span>
          <Wheel
            key={`minutes-${opening}`}
            values={minutes}
            value={minute}
            onChange={setMinute}
            label={`${id}-Минуты`}
          />
        </div>
        <div className="time-picker-actions">
          <button type="button" className="secondary" onClick={close}>
            Отмена
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              onChange(`${hour}:${minute}`);
              close();
            }}
          >
            Готово
          </button>
        </div>
        <button
          type="button"
          className="text-button time-picker-clear"
          onClick={() => {
            onChange("");
            close();
          }}
        >
          Очистить
        </button>
      </dialog>
    </>
  );
}
