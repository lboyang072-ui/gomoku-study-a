/** Coordinates are row-first, zero-based internally; external columns include I. */
export function parse_coord(pos) {
  if (typeof pos !== 'string') throw new TypeError('Coordinate must be a string');
  const match = /^([A-O])([1-9]|1[0-5])$/.exec(pos.trim().toUpperCase());
  if (!match) throw new TypeError('Expected A1–O15');
  return {row: Number(match[2]) - 1, col: match[1].charCodeAt(0) - 65};
}
export function format_coord(row, col) {
  if (![row,col].every(n => Number.isInteger(n) && n >= 0 && n < 15)) {
    throw new TypeError('Row and column must be integers in 0..14');
  }
  return String.fromCharCode(65 + col) + (row + 1);
}
export function pieces_to_matrix(pieces) {
  if (!Array.isArray(pieces)) throw new TypeError('Expected pieces array');
  const matrix = Array.from({length:15}, () => Array(15).fill(null));
  for (const piece of pieces) {
    if (!piece || typeof piece !== 'object' || Array.isArray(piece)) throw new TypeError('Expected piece object');
    const {row,col} = parse_coord(piece.pos);
    if (matrix[row][col] !== null) throw new TypeError('Duplicate coordinate');
    if (piece.color !== 'B' && piece.color !== 'W') throw new TypeError('Expected B/W');
    matrix[row][col] = piece.color;
  }
  return matrix;
}
export function matrix_to_pieces(matrix) {
  if (!Array.isArray(matrix) || matrix.length !== 15) throw new TypeError('Expected 15 rows');
  const pieces = [];
  for (let row=0;row<15;row++) {
    if (!Array.isArray(matrix[row]) || matrix[row].length !== 15) throw new TypeError('Expected 15 columns');
    for (let col=0;col<15;col++) {
      const color=matrix[row][col];
      if (color !== null && color !== 'B' && color !== 'W') throw new TypeError('Expected null/B/W');
      if (color !== null) pieces.push({pos:format_coord(row,col),color});
    }
  }
  return pieces;
}
