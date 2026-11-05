import {parse_coord,format_coord,pieces_to_matrix} from './coord.mjs';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const color = value => value === 'B' || value === 'W';
const failure = (error_code,detail) => ({valid_position:false,error_code,detail});
const inside = (r,c) => r>=0 && r<15 && c>=0 && c<15;
const directions = [[0,1],[1,0],[1,1],[1,-1]];

/** Internal shared scanner: maximal runs only, canonical numeric coordinate order. */
export function scan_lines(matrix) {
  const found={B:[],W:[]};
  for(let r=0;r<15;r++) for(let c=0;c<15;c++) {
    const side=matrix[r][c];
    if(side===null) continue;
    for(const [dr,dc] of directions) {
      if(inside(r-dr,c-dc) && matrix[r-dr][c-dc]===side) continue;
      const line=[];
      for(let rr=r,cc=c;inside(rr,cc)&&matrix[rr][cc]===side;rr+=dr,cc+=dc) line.push(rr*15+cc);
      if(line.length>=5) found[side].push(line.sort((a,b)=>a-b));
    }
  }
  for(const side of ['B','W']) found[side].sort((a,b)=>{
    for(let i=0;i<Math.min(a.length,b.length);i++) if(a[i]!==b[i]) return a[i]-b[i];
    return a.length-b.length;
  });
  return found;
}
export const line_coords = line => line.map(key=>format_coord(Math.floor(key/15),key%15));

/** Whether a stone already placed at (row,col) makes five or more. */
function wins_at(matrix,row,col,side) {
  return directions.some(([dr,dc]) => {
    let count=1;
    for(const sign of [-1,1]) {
      for(let r=row+sign*dr,c=col+sign*dc;
          inside(r,c)&&matrix[r][c]===side;r+=sign*dr,c+=sign*dc) count++;
    }
    return count>=5;
  });
}

/** Private-matrix simulation deliberately does not revalidate turn counts. */
function immediate_wins(matrix,side) {
  const points=[];
  for(let row=0;row<15;row++) for(let col=0;col<15;col++) {
    if(matrix[row][col]!==null) continue;
    matrix[row][col]=side;
    if(wins_at(matrix,row,col,side)) points.push(format_coord(row,col));
    matrix[row][col]=null;
  }
  return points;
}

function task_answers(matrix,side,type) {
  if(type==='win_in_1') {
    const accepted_moves=immediate_wins(matrix,side);
    return accepted_moves.length ? {accepted_moves}
      : {error:failure('invalid_task_config','Attack has no immediate winning point')};
  }
  const opponent=side==='B'?'W':'B';
  if(immediate_wins(matrix,opponent).length===0) {
    return {error:failure('invalid_task_config','Defense requires an initial opponent winning threat')};
  }
  const accepted_moves=[];
  for(let row=0;row<15;row++) for(let col=0;col<15;col++) {
    if(matrix[row][col]!==null) continue;
    matrix[row][col]=side;
    if(wins_at(matrix,row,col,side)||immediate_wins(matrix,opponent).length===0) {
      accepted_moves.push(format_coord(row,col));
    }
    matrix[row][col]=null;
  }
  return {accepted_moves}; // An empty defense set is a valid diagnostic result.
}

function load_task(task,side,matrix) {
  if(!object(task)||(task.type!=='win_in_1'&&task.type!=='block_1')||task.task_side!==side) {
    return {error:failure('invalid_task_config','Expected win_in_1/block_1 with matching task_side')};
  }
  let expected;
  if(Object.hasOwn(task,'accepted_moves')) {
    if(!Array.isArray(task.accepted_moves)) return {error:failure('invalid_task_config','Expected an accepted_moves array')};
    const keys=[];
    try {
      for(const pos of task.accepted_moves) {
        const {row,col}=parse_coord(pos);
        keys.push(row*15+col);
      }
    } catch {return {error:failure('invalid_task_config','Invalid accepted_moves coordinate')};}
    if(new Set(keys).size!==keys.length) return {error:failure('invalid_task_config','Duplicate accepted_moves coordinate')};
    expected=keys.sort((a,b)=>a-b).map(key=>format_coord(Math.floor(key/15),key%15));
  }
  const result=task_answers(matrix,side,task.type);
  if(result.error) return result;
  if(expected && (expected.length!==result.accepted_moves.length ||
      expected.some((pos,i)=>pos!==result.accepted_moves[i]))) {
    return {error:failure('answer_set_mismatch','Supplied answers differ from the complete computed set')};
  }
  return {task_type:task.type,accepted_moves:result.accepted_moves};
}

/** Internal loader returns private working matrix only after all ordered checks. */
export function load_position(payload, options={}) {
  if(!object(payload)||!object(payload.board)||!Array.isArray(payload.board.pieces)||
     !Array.from(payload.board.pieces).every(object)) return {error:failure('bad_input','Expected payload, board and piece objects with a pieces array')};
  if(!Object.hasOwn(payload,'rules_version')) return {error:failure('missing_rules_version','rules_version is required')};
  if(payload.rules_version!=='GOMOKU-R001/v0.1') return {error:failure('unsupported_rules_version','Expected GOMOKU-R001/v0.1')};
  if(!color(payload.side_to_move)) return {error:failure('missing_side_to_move','Expected side_to_move B/W')};
  if(payload.board.size!==15) return {error:failure('bad_board_size','Expected numeric size 15')};
  const seen=new Set();
  for(const p of payload.board.pieces) {
    let key;
    try {const {row,col}=parse_coord(p.pos);key=row*15+col;} catch {return {error:failure('bad_coordinate','Invalid piece coordinate')};}
    if(seen.has(key)) return {error:failure('bad_coordinate','Duplicate normalized coordinate')};
    seen.add(key);
  }
  if(!payload.board.pieces.every(p=>color(p.color))) return {error:failure('bad_color','Expected piece color B/W')};
  const black=payload.board.pieces.filter(p=>p.color==='B').length;
  const white=payload.board.pieces.length-black;
  if(black!==white && black!==white+1) return {error:failure('piece_count_mismatch',`Black ${black}, white ${white}`)};
  if(payload.side_to_move!==(black===white?'B':'W')) return {error:failure('side_mismatch','Side does not match alternating counts')};
  const matrix=pieces_to_matrix(payload.board.pieces);
  const lines=scan_lines(matrix);
  const b=lines.B.length>0,w=lines.W.length>0;
  if((b&&w)||(b&&black!==white+1)||(w&&black!==white)) return {error:failure('invalid_terminal_position','Winner/count contradiction')};
  if(b||w) {
    // A possible last stone must intersect every winning maximal run. Removing
    // it must also split any long run so neither remaining arm is still five.
    const side=b?'B':'W';
    let reachable=false;
    for(const key of lines[side][0]) {
      if(!lines[side].every(line=>line.includes(key))) continue;
      const r=Math.floor(key/15),c=key%15;
      matrix[r][c]=null;
      const prior=scan_lines(matrix);
      matrix[r][c]=side;
      if(prior.B.length===0 && prior.W.length===0) {reachable=true;break;}
    }
    if(!reachable) return {error:failure('invalid_terminal_position','No single last stone removes all winning runs')};
  }
  const terminal=b||w||seen.size===225;
  const task=payload.task!==undefined && payload.task!==null;
  const allow=options?.allow_terminal_board===true && !task;
  if((b||w)&&!allow) return {error:failure('already_won','Initial board already has a winner')};
  if(seen.size===225&&!allow) return {error:failure('already_drawn','Initial board is full')};
  const task_result=task?load_task(payload.task,payload.side_to_move,matrix):{};
  if(task_result.error) return task_result;
  return {matrix,terminal,...task_result};
}
export function validate_position(payload,options={allow_terminal_board:false}) {
  return load_position(payload,options).error ?? {valid_position:true};
}
