import {parse_coord,format_coord,matrix_to_pieces} from './coord.mjs';
import {load_position,scan_lines,line_coords} from './validator.mjs';
export {validate_position} from './validator.mjs';
const illegal = reason => ({valid_position:true,legality:{legal:false,reason}});

export function evaluate_move(payload,options={allow_terminal_board:false}) {
  const loaded=load_position(payload,options);
  if(loaded.error) return loaded.error;
  if(loaded.terminal) return illegal('game_over');
  const move=payload.move;
  if(!move || typeof move!=='object' || Array.isArray(move) || (move.color!=='B'&&move.color!=='W')) return illegal('invalid_move');
  if(move.color!==payload.side_to_move) return illegal('wrong_side');
  let row,col;
  try {({row,col}=parse_coord(move.pos));} catch {return illegal('out_of_bounds');}
  const matrix=loaded.matrix;
  if(matrix[row][col]!==null) return illegal('occupied');
  matrix[row][col]=move.color;
  const lines=scan_lines(matrix)[move.color].filter(line=>line.includes(row*15+col)).map(line_coords);
  const pieces=matrix_to_pieces(matrix);
  const winner=lines.length?move.color:null;
  const status=winner?(winner==='B'?'black_wins':'white_wins'):(pieces.length===225?'draw':'ongoing');
  const result={
    valid_position:true,legality:{legal:true,reason:null},board_after:{size:15,pieces},
    game_state:{status,winner,win_lines:lines,next_side_to_move:status==='ongoing'?(move.color==='B'?'W':'B'):null},
  };
  if(loaded.task_type) {
    const correct=loaded.accepted_moves.includes(format_coord(row,col));
    const reason=loaded.task_type==='win_in_1'
      ? (correct?'落子成五':'未形成五连')
      : (winner?'己方直接成五获胜':(correct?'对方所有立即成五点均被阻止':'未能阻止对方全部立即成五威胁'));
    result.answer={correct,reason,accepted_moves:loaded.accepted_moves};
  }
  return result;
}

export function enumerate_accepted_moves(board,side_to_move,task_type) {
  const loaded=load_position({
    rules_version:'GOMOKU-R001/v0.1',board,side_to_move,
    task:{type:task_type,task_side:side_to_move},
  });
  return loaded.error ?? {valid_position:true,accepted_moves:loaded.accepted_moves};
}
