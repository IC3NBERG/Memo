/* ══════════════════════════════════════════════════════════════
   BLOCK MODEL — operazioni pure sull'overlay dell'editor a blocchi.
   Usato dal renderer e testabile in Node senza DOM.
   ══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MemoBlockModel = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_HISTORY = 80;
  const MAX_TAG_LENGTH = 40;

  function cloneEdits(edits) {
    const source = edits && typeof edits === 'object' ? edits : {};
    return {
      ...source,
      segmentText: { ...(source.segmentText || {}) },
      hiddenSegmentIds: [...(source.hiddenSegmentIds || [])],
      tags: Object.fromEntries(
        Object.entries(source.tags || {}).map(([id, values]) => [id, [...(values || [])]]),
      ),
      annotations: Object.fromEntries(
        Object.entries(source.annotations || {}).map(([id, values]) => [
          id,
          (values || []).map((annotation) => ({ ...annotation })),
        ]),
      ),
      order: Array.isArray(source.order) ? [...source.order] : null,
      groups: (source.groups || []).map((group) => ({
        ...group,
        segmentIds: [...(group.segmentIds || [])],
      })),
    };
  }

  function createHistory() {
    return { past: [], future: [] };
  }

  function pushHistory(history, edits) {
    history.past.push(cloneEdits(edits));
    if (history.past.length > MAX_HISTORY) history.past.shift();
    history.future = [];
  }

  function undo(history, currentEdits) {
    if (!history.past.length) return null;
    history.future.push(cloneEdits(currentEdits));
    return history.past.pop();
  }

  function redo(history, currentEdits) {
    if (!history.future.length) return null;
    history.past.push(cloneEdits(currentEdits));
    return history.future.pop();
  }

  function segmentMap(sourceSegments) {
    return new Map((sourceSegments || []).map((segment) => [segment.id, segment]));
  }

  /**
   * Ordine completo degli ID, nascosti inclusi. Rispecchia projection.js:
   * `order` parziale, ID mancanti in coda nell'ordine della sorgente.
   */
  function orderedIds(sourceSegments, edits) {
    const ids = (sourceSegments || []).map((segment) => segment.id);
    const known = new Set(ids);
    if (!Array.isArray(edits?.order)) return ids;

    const seen = new Set();
    const explicit = [];
    for (const id of edits.order) {
      if (!known.has(id) || seen.has(id)) continue;
      seen.add(id);
      explicit.push(id);
    }
    return explicit.concat(ids.filter((id) => !seen.has(id)));
  }

  function segmentTextFor(segment, edits) {
    const override = edits?.segmentText?.[segment.id];
    return typeof override === 'string' ? override : segment.text;
  }

  function visibleBlocks(sourceSegments, edits) {
    const hidden = new Set(edits?.hiddenSegmentIds || []);
    const byId = segmentMap(sourceSegments);
    return orderedIds(sourceSegments, edits)
      .filter((id) => !hidden.has(id))
      .map((id) => {
        const segment = byId.get(id);
        return { ...segment, text: segmentTextFor(segment, edits) };
      });
  }

  function hiddenBlocks(sourceSegments, edits) {
    const hidden = new Set(edits?.hiddenSegmentIds || []);
    const byId = segmentMap(sourceSegments);
    return orderedIds(sourceSegments, edits)
      .filter((id) => hidden.has(id))
      .map((id) => {
        const segment = byId.get(id);
        return { ...segment, text: segmentTextFor(segment, edits) };
      });
  }

  function projectText(sourceSegments, edits) {
    return visibleBlocks(sourceSegments, edits)
      .map((segment) => segment.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function setSegmentText(edits, segmentId, text) {
    return {
      ...cloneEdits(edits),
      segmentText: { ...(edits.segmentText || {}), [segmentId]: String(text ?? '') },
    };
  }

  function setHidden(edits, segmentId, hidden) {
    const next = cloneEdits(edits);
    const values = new Set(next.hiddenSegmentIds);
    if (hidden) values.add(segmentId);
    else values.delete(segmentId);
    next.hiddenSegmentIds = [...values];
    return next;
  }

  function isHidden(edits, segmentId) {
    return (edits?.hiddenSegmentIds || []).includes(segmentId);
  }

  function normalizeTag(tag) {
    return String(tag ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH);
  }

  function addTag(edits, segmentId, tag) {
    const value = normalizeTag(tag);
    if (!value) return cloneEdits(edits);
    const next = cloneEdits(edits);
    const values = new Set(next.tags[segmentId] || []);
    values.add(value);
    next.tags[segmentId] = [...values];
    return next;
  }

  function removeTag(edits, segmentId, tag) {
    const next = cloneEdits(edits);
    const values = (next.tags[segmentId] || []).filter((value) => value !== tag);
    if (values.length) next.tags[segmentId] = values;
    else delete next.tags[segmentId];
    return next;
  }

  function makeId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function addAnnotation(edits, segmentId, text, options = {}) {
    const body = String(text ?? '').trim();
    if (!body) return cloneEdits(edits);
    const annotation = {
      id: options.id || makeId('a'),
      text: body,
      createdAt: options.createdAt || new Date().toISOString(),
    };
    const next = cloneEdits(edits);
    next.annotations[segmentId] = [...(next.annotations[segmentId] || []), annotation];
    return next;
  }

  function removeAnnotation(edits, segmentId, annotationId) {
    const next = cloneEdits(edits);
    const values = (next.annotations[segmentId] || [])
      .filter((annotation) => annotation.id !== annotationId);
    if (values.length) next.annotations[segmentId] = values;
    else delete next.annotations[segmentId];
    return next;
  }

  function createGroup(edits, title, options = {}) {
    const name = String(title ?? '').replace(/\s+/g, ' ').trim();
    if (!name) return cloneEdits(edits);
    const next = cloneEdits(edits);
    next.groups.push({
      id: options.id || makeId('g'),
      title: name,
      segmentIds: [],
    });
    return next;
  }

  function renameGroup(edits, groupId, title) {
    const name = String(title ?? '').replace(/\s+/g, ' ').trim();
    if (!name) return cloneEdits(edits);
    const next = cloneEdits(edits);
    next.groups = next.groups.map((group) =>
      (group.id === groupId ? { ...group, title: name } : group));
    return next;
  }

  function deleteGroup(edits, groupId) {
    const next = cloneEdits(edits);
    next.groups = next.groups.filter((group) => group.id !== groupId);
    return next;
  }

  function toggleSegmentInGroup(edits, groupId, segmentId) {
    const next = cloneEdits(edits);
    next.groups = next.groups.map((group) => {
      if (group.id !== groupId) return group;
      const values = new Set(group.segmentIds);
      if (values.has(segmentId)) values.delete(segmentId);
      else values.add(segmentId);
      return { ...group, segmentIds: [...values] };
    });
    return next;
  }

  /**
   * Sposta un blocco visibile di una posizione. L'ordine salvato contiene solo
   * i blocchi visibili: i nascosti restano in coda alla proiezione e non
   * interferiscono con i movimenti.
   */
  function moveSegment(edits, segmentId, direction, visibleIds) {
    const ids = [...(visibleIds || [])];
    const index = ids.indexOf(segmentId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= ids.length) return cloneEdits(edits);

    [ids[index], ids[target]] = [ids[target], ids[index]];
    return { ...cloneEdits(edits), order: ids };
  }

  function clearLegacyText(edits) {
    const next = cloneEdits(edits);
    delete next.legacyDocumentText;
    return next;
  }

  function hasLegacyText(edits) {
    return typeof edits?.legacyDocumentText === 'string';
  }

  function groupsForSegment(edits, segmentId) {
    return (edits?.groups || []).filter((group) =>
      (group.segmentIds || []).includes(segmentId));
  }

  return {
    MAX_HISTORY,
    addAnnotation,
    addTag,
    clearLegacyText,
    cloneEdits,
    createGroup,
    createHistory,
    deleteGroup,
    groupsForSegment,
    hasLegacyText,
    hiddenBlocks,
    isHidden,
    moveSegment,
    normalizeTag,
    orderedIds,
    projectText,
    pushHistory,
    redo,
    removeAnnotation,
    removeTag,
    renameGroup,
    segmentTextFor,
    setHidden,
    setSegmentText,
    toggleSegmentInGroup,
    undo,
    visibleBlocks,
  };
});
