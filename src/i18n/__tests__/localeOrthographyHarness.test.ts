// @vitest-environment node
/** Runs the orthography harness for `es` as a live example (and guards the harness). */
import { describeLocaleOrthography } from './helpers/localeOrthography';

describeLocaleOrthography('es', {
  forbidden: [['paciente', /\bpaciente/i]],
});
