export const FORM_IDS = Object.freeze(['A', 'B', 'C']);
export const FORM_STAGE_ORDER = Object.freeze([
  'baseline', 'baseline', 'baseline',
  'practice', 'practice', 'practice', 'practice',
  'posttest', 'posttest', 'posttest',
]);
export const FORM_ORDERS = Object.freeze({
  A: Object.freeze(['DEF-A04', 'DEF-B06', 'DEF-C01', 'ATT-PHOTO-02', 'DEF-C03', 'DEF-D01', 'DEF-D03', 'DEF-D05', 'DEF-E04', 'DEF-D09']),
  B: Object.freeze(['DEF-A08', 'DEF-A02', 'DEF-B08', 'ATT-BATCH-001', 'DEF-C07', 'DEF-D07', 'DEF-E05', 'DEF-B03', 'DEF-B04', 'DEF-C09']),
  C: Object.freeze(['DEF-A03', 'DEF-A10', 'DEF-D10', 'ATT-E06', 'DEF-D06', 'DEF-E02', 'DEF-C06', 'DEF-B02', 'DEF-B05', 'DEF-C10']),
});

export function isPairId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(value);
}

export function formForPair(pairId) {
  if (!isPairId(pairId)) throw new Error('主持人链接配对编号无效');
  const number = pairId.match(/(?:^|[-_])(\d+)$/)?.[1];
  // Consecutive group numbers rotate through the forms, starting with A.
  if (number) return FORM_IDS[Number((BigInt(number) + 2n) % 3n)];
  let hash = 2166136261;
  for (const character of pairId) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return FORM_IDS[hash % FORM_IDS.length];
}

export function hasFormOrder(study) {
  if (!FORM_IDS.includes(study?.form_id) || !Array.isArray(study.items)) return false;
  const order = FORM_ORDERS[study.form_id];
  return study.items.length === order.length &&
    study.items.every((item, index) => item.id === order[index] && item.stage === FORM_STAGE_ORDER[index]);
}

export function formHashes(manifest, formId) {
  const key = 'form_' + formId.toLowerCase();
  return {
    study: manifest[key + '_sha256'],
    advice: manifest[key + '_advice_sha256'],
    protocol: manifest[key + '_protocol_sha256'],
  };
}

export async function loadForm(formId) {
  if (!FORM_IDS.includes(formId)) throw new Error('参与链接卷号无效');
  const suffix = formId.toLowerCase();
  const [infoRes, studyRes, adviceRes] = await Promise.all(
    ['./build-info.json', './study-' + suffix + '.json', './advice-' + suffix + '.json']
      .map(path => fetch(new URL(path, import.meta.url))),
  );
  if (![infoRes, studyRes, adviceRes].every(response => response.ok)) {
    throw new Error('实验材料未包含在本地构建中');
  }
  const [manifest, studyBytes, adviceBytes] = await Promise.all([
    infoRes.json(), studyRes.arrayBuffer(), adviceRes.arrayBuffer(),
  ]);
  const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  const hashes = formHashes(manifest, formId);
  if (manifest.schema_version !== 'gomoku-web-manifest/v1' ||
      hashes.study !== await digest(studyBytes) || hashes.advice !== await digest(adviceBytes)) {
    throw new Error('实验材料完整性核对失败');
  }
  const decode = bytes => JSON.parse(new TextDecoder().decode(bytes));
  const study = decode(studyBytes);
  const advice = decode(adviceBytes);
  if (study.form_id !== formId || !hasFormOrder(study) || advice.form_id !== formId ||
      study.items.some(item => item.task.task_side !== item.side_to_move) ||
      advice.items?.map(item => item.item_id).join('|') !== FORM_ORDERS[formId].slice(3, 7).join('|')) {
    throw new Error('实验材料题序/题量不匹配');
  }
  if (study.protocol_sha256 !== hashes.protocol || study.protocol_version !== advice.protocol_version ||
      study.rules_version !== manifest.rules_version || study.material_version !== manifest.material_version) {
    throw new Error('实验材料或协议版本不匹配');
  }
  return { study: {...study, study_sha256: hashes.study, advice_sha256: hashes.advice}, advice, manifest };
}
