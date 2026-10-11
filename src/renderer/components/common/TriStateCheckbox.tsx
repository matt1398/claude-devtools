import React, { useEffect, useRef } from 'react';

/** Checkbox that supports the indeterminate (partial) state. */
export const TriStateCheckbox = ({
  checked,
  indeterminate,
  onChange,
  className,
  title,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  className?: string;
  title?: string;
}): React.JSX.Element => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className={className}
      title={title}
      aria-label={title}
    />
  );
};
