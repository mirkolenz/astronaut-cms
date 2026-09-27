import { FieldRenderer } from "@/client/components/editors/field-renderer";
import { isRequired, type FieldSchema } from "@/shared/field-schema";

export function EntryFields({
  shape,
  data,
  onChange,
}: {
  shape: Record<string, FieldSchema>;
  data: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  return Object.entries(shape).map(([key, schema]) => (
    <FieldRenderer
      key={key}
      schema={schema}
      value={data[key]}
      onChange={(value) => onChange(key, value)}
      name={key}
      required={isRequired(schema)}
    />
  ));
}
