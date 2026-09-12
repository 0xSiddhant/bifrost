import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { useId } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Input({ label, ...rest }: InputProps) {
  const id = useId();
  return (
    <div className="field">
      {label && (
        <label className="field__label" htmlFor={id}>
          {label}
        </label>
      )}
      <input id={id} className="field__input" {...rest} />
    </div>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

/** Same label/field wiring as Input, for the multi-line inputs the toolbox
 *  tools are mostly made of. */
export function Textarea({ label, ...rest }: TextareaProps) {
  const id = useId();
  return (
    <div className="field">
      {label && (
        <label className="field__label" htmlFor={id}>
          {label}
        </label>
      )}
      <textarea id={id} className="field__input" {...rest} />
    </div>
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  children: ReactNode;
}

export function Select({ label, children, ...rest }: SelectProps) {
  const id = useId();
  return (
    <div className="field">
      {label && (
        <label className="field__label" htmlFor={id}>
          {label}
        </label>
      )}
      <select id={id} className="field__input" {...rest}>
        {children}
      </select>
    </div>
  );
}
