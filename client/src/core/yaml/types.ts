/** A syntax error, positioned for the lint gutter. Mirrors `core/json`'s shape. */
export interface YamlIssue {
  offset: number;
  length: number;
  message: string;
  /** 1-based, for the advisory rail and error copy that names a line. */
  line: number;
}

export type AdvisoryKind =
  | 'norway'
  | 'duplicate-key'
  | 'tab-indent'
  | 'version-like'
  | 'unsafe-integer'
  | 'anchor';

/**
 * A warning about a document that is **valid** and probably does not mean what
 * it looks like — the class of problem the tool's name is a joke about. Never
 * blocking, never auto-fixed: the point is that the bytes are the user's.
 */
export interface YamlAdvisory {
  kind: AdvisoryKind;
  /** What is wrong, in one sentence, naming the value where it helps. */
  message: string;
  offset: number;
  length: number;
  /** 1-based. */
  line: number;
}
