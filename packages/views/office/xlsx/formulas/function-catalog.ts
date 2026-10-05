// Wave A / A8 (UNI-926): the curated spreadsheet function catalog. It is the
// single source for the Function Library dialog and the formula-bar hints.
//
// Deliberately bounded: the usual Excel categories, roughly 60 functions, not
// the full catalog. Names and signatures are never translated; only the
// category labels and the one-line descriptions carry i18n keys
// (`office.xlsx.formulas.categories.*` / `office.xlsx.formulas.fn.<name>`).

/** The catalog's categories, in Excel's tab order (the app's own subset). */
export type XlsxFunctionCategory =
  | "math"
  | "statistical"
  | "text"
  | "date"
  | "lookup"
  | "logical"
  | "financial";

export const XLSX_FUNCTION_CATEGORIES: readonly XlsxFunctionCategory[] = [
  "math",
  "statistical",
  "text",
  "date",
  "lookup",
  "logical",
  "financial",
];

/** One catalog row. `signature` is the Excel syntax line (required arguments
 *  bare, optional ones in brackets, a repeating tail as an ellipsis). */
export interface XlsxFunctionSpec {
  /** Upper-case Excel function name; also the text inserted into the cell. */
  readonly name: string;
  readonly category: XlsxFunctionCategory;
  readonly signature: string;
  /** i18n key under `office.xlsx.formulas.fn.<name>` in BOTH locales. */
  readonly descriptionKey: string;
}

const fn = (
  name: string,
  category: XlsxFunctionCategory,
  signature: string,
): XlsxFunctionSpec => ({
  name,
  category,
  signature,
  descriptionKey: `office.xlsx.formulas.fn.${name.toLowerCase()}`,
});

export const XLSX_FUNCTIONS: readonly XlsxFunctionSpec[] = [
  // Math & trigonometry
  fn("SUM", "math", "SUM(number1, [number2], ...)"),
  fn("SUMIF", "math", "SUMIF(range, criteria, [sum_range])"),
  fn("SUMIFS", "math", "SUMIFS(sum_range, criteria_range1, criteria1, ...)"),
  fn("SUMPRODUCT", "math", "SUMPRODUCT(array1, [array2], ...)"),
  fn("ABS", "math", "ABS(number)"),
  fn("ROUND", "math", "ROUND(number, num_digits)"),
  fn("ROUNDUP", "math", "ROUNDUP(number, num_digits)"),
  fn("ROUNDDOWN", "math", "ROUNDDOWN(number, num_digits)"),
  fn("INT", "math", "INT(number)"),
  fn("MOD", "math", "MOD(number, divisor)"),
  fn("POWER", "math", "POWER(number, power)"),
  fn("SQRT", "math", "SQRT(number)"),
  fn("RAND", "math", "RAND()"),
  fn("RANDBETWEEN", "math", "RANDBETWEEN(bottom, top)"),
  // Statistical
  fn("AVERAGE", "statistical", "AVERAGE(number1, [number2], ...)"),
  fn("AVERAGEIF", "statistical", "AVERAGEIF(range, criteria, [average_range])"),
  fn("COUNT", "statistical", "COUNT(value1, [value2], ...)"),
  fn("COUNTA", "statistical", "COUNTA(value1, [value2], ...)"),
  fn("COUNTIF", "statistical", "COUNTIF(range, criteria)"),
  fn("COUNTIFS", "statistical", "COUNTIFS(criteria_range1, criteria1, ...)"),
  fn("MIN", "statistical", "MIN(number1, [number2], ...)"),
  fn("MAX", "statistical", "MAX(number1, [number2], ...)"),
  fn("MEDIAN", "statistical", "MEDIAN(number1, [number2], ...)"),
  fn("LARGE", "statistical", "LARGE(array, k)"),
  fn("SMALL", "statistical", "SMALL(array, k)"),
  // Text
  fn("CONCATENATE", "text", "CONCATENATE(text1, [text2], ...)"),
  fn("TEXT", "text", "TEXT(value, format_text)"),
  fn("LEFT", "text", "LEFT(text, [num_chars])"),
  fn("RIGHT", "text", "RIGHT(text, [num_chars])"),
  fn("MID", "text", "MID(text, start_num, num_chars)"),
  fn("LEN", "text", "LEN(text)"),
  fn("TRIM", "text", "TRIM(text)"),
  fn("UPPER", "text", "UPPER(text)"),
  fn("LOWER", "text", "LOWER(text)"),
  fn("SUBSTITUTE", "text", "SUBSTITUTE(text, old_text, new_text, [instance_num])"),
  // Date & time
  fn("TODAY", "date", "TODAY()"),
  fn("NOW", "date", "NOW()"),
  fn("DATE", "date", "DATE(year, month, day)"),
  fn("YEAR", "date", "YEAR(serial_number)"),
  fn("MONTH", "date", "MONTH(serial_number)"),
  fn("DAY", "date", "DAY(serial_number)"),
  fn("EDATE", "date", "EDATE(start_date, months)"),
  // Lookup & reference
  fn("VLOOKUP", "lookup", "VLOOKUP(lookup_value, table_array, col_index_num, [range_lookup])"),
  fn("HLOOKUP", "lookup", "HLOOKUP(lookup_value, table_array, row_index_num, [range_lookup])"),
  fn("INDEX", "lookup", "INDEX(array, row_num, [column_num])"),
  fn("MATCH", "lookup", "MATCH(lookup_value, lookup_array, [match_type])"),
  fn("CHOOSE", "lookup", "CHOOSE(index_num, value1, [value2], ...)"),
  // Logical
  fn("IF", "logical", "IF(logical_test, value_if_true, [value_if_false])"),
  fn("IFERROR", "logical", "IFERROR(value, value_if_error)"),
  fn("AND", "logical", "AND(logical1, [logical2], ...)"),
  fn("OR", "logical", "OR(logical1, [logical2], ...)"),
  fn("NOT", "logical", "NOT(logical)"),
  // Financial
  fn("PMT", "financial", "PMT(rate, nper, pv, [fv], [type])"),
  fn("FV", "financial", "FV(rate, nper, pmt, [pv], [type])"),
  fn("PV", "financial", "PV(rate, nper, pmt, [fv], [type])"),
  fn("RATE", "financial", "RATE(nper, pmt, pv, [fv], [type], [guess])"),
  fn("NPER", "financial", "NPER(rate, pmt, pv, [fv], [type])"),
  fn("NPV", "financial", "NPV(rate, value1, [value2], ...)"),
  fn("IRR", "financial", "IRR(values, [guess])"),
];

/** The visible category label key (translated in both locales). */
export function functionCategoryLabelKey(category: XlsxFunctionCategory): string {
  return `office.xlsx.formulas.categories.${category}`;
}

/** The function name as the renderer's cell payload wants it: `=NAME(`. */
export function functionInsertionText(name: string): string {
  return `=${name.toUpperCase()}(`;
}

/** The dialog's list filter: category plus a case-insensitive name substring.
 *  The search deliberately matches names only (Excel's dialog does the same
 *  before a function is picked). */
export function matchFunctions(
  query: string,
  category: XlsxFunctionCategory | "all" = "all",
): XlsxFunctionSpec[] {
  const needle = query.trim().toUpperCase();
  return XLSX_FUNCTIONS.filter(
    (spec) =>
      (category === "all" || spec.category === category) &&
      (needle === "" || spec.name.includes(needle)),
  );
}