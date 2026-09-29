function imageShape(width,height) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>8192||height>8192)
    throw new Error('Invalid image shape');
}
export function rgbaToNchw(data,width=320,height=240) {
  imageShape(width,height);
  if(data.length!==width*height*4) throw new Error('Invalid image shape');
  const out=new Float32Array(width*height*3), n=width*height;
  const byteInput=data instanceof Uint8Array||data instanceof Uint8ClampedArray;
  for(let i=0;i<n;i++) {
    const r=data[i*4],g=data[i*4+1],b=data[i*4+2];
    if(!byteInput&&(!Number.isFinite(r)||!Number.isFinite(g)||!Number.isFinite(b)||r<0||g<0||b<0||r>255||g>255||b>255))throw new Error('Invalid image sample');
    out[i]=(r-127)/128;out[n+i]=(g-127)/128;out[2*n+i]=(b-127)/128;
  }
  return out;
}
export function iou(a,b) {
  const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),right=Math.min(a.x+a.width,b.x+b.width),bottom=Math.min(a.y+a.height,b.y+b.height);
  const inter=Math.max(0,right-x)*Math.max(0,bottom-y);
  return inter/(a.width*a.height+b.width*b.height-inter||1);
}
export function decodeFaces(scores,boxes,width,height,threshold=.7) {
  imageShape(width,height);
  if(!Number.isFinite(threshold)||threshold<0||threshold>1)throw new Error('Invalid face threshold');
  if(!scores?.length||scores.length%2||scores.length>200000||boxes?.length!==scores.length*2) throw new Error('Unexpected face model outputs');
  // A malformed tensor is a failed inference, never a clean/no-face result.
  for(const score of scores)if(!Number.isFinite(score)||score<0||score>1)throw new Error('Invalid face model score');
  for(const coordinate of boxes)if(!Number.isFinite(coordinate))throw new Error('Invalid face model box');
  const candidates=[];
  for(let i=0;i<scores.length/2;i++) {
    if(scores[i*2+1]<threshold) continue;
    const x=Math.max(0,boxes[i*4]*width),y=Math.max(0,boxes[i*4+1]*height);
    const right=Math.min(width,boxes[i*4+2]*width),bottom=Math.min(height,boxes[i*4+3]*height);
    if(right>x && bottom>y) candidates.push({kind:'face',x,y,width:right-x,height:bottom-y,confidence:scores[i*2+1]});
  }
  candidates.sort((a,b)=>b.confidence-a.confidence);
  const kept=[];
  for(const c of candidates) if(kept.every(k=>iou(c,k)<.3)){kept.push(c);if(kept.length===100)break;}
  return kept;
}
export async function createVisionDetector({runtimeUrl='/models/ort/ort.wasm.min.mjs',modelUrl='/models/ultraface-rfb320.onnx'}={}) {
  const ort=await import(/* @vite-ignore */ runtimeUrl);
  ort.env.wasm.wasmPaths=new URL('.',new URL(runtimeUrl,location.href)).href;
  ort.env.wasm.numThreads=1;
  ort.env.wasm.proxy=false;
  const session=await ort.InferenceSession.create(modelUrl,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
  let canvas,ctx;
  try {
    canvas=new OffscreenCanvas(320,240);ctx=canvas.getContext('2d',{willReadFrequently:true});
    if(!ctx)throw new Error('Vision canvas unavailable');
  } catch(error) {await session.release();throw error;}
  let disposed=false,active=null,releasePromise=null;
  async function infer(source) {
    const width=source?.width,height=source?.height;
    imageShape(width,height);
    let bitmap,tensor;const tensors=new Set();
    try {
      bitmap=typeof ImageData!=='undefined'&&source instanceof ImageData?await createImageBitmap(source):source;
      ctx.drawImage(bitmap,0,0,320,240);
      tensor=new ort.Tensor('float32',rgbaToNchw(ctx.getImageData(0,0,320,240).data),[1,3,240,320]);
      tensors.add(tensor);
      const start=performance.now();
      const output=await session.run({[session.inputNames[0]]:tensor});
      const inferenceMs=performance.now()-start;
      const outputs=Object.values(output);for(const value of outputs)tensors.add(value);
      const scores=outputs.find(t=>t.dims.at(-1)===2);const boxes=outputs.find(t=>t.dims.at(-1)===4);
      if(!scores||!boxes) throw new Error('Unexpected face model outputs');
      const detections=decodeFaces(scores.data,boxes.data,width,height);
      return {detections,inputWidth:width,inputHeight:height,inferenceMs,model:'UltraFace RFB-320',local:true,backend:'wasm-single-thread'};
    } finally {
      // Release on rejected inference/invalid output as well as successful runs.
      // Remove resized raw pixels from the reusable canvas after each attempt.
      const failures=[];
      for(const t of tensors){try{t.dispose();}catch(error){failures.push(error);}}
      try{ctx.clearRect(0,0,320,240);}catch(error){failures.push(error);}
      try{if(bitmap && bitmap!==source)bitmap.close();}catch(error){failures.push(error);}
      if(failures.length)throw new AggregateError(failures,'Vision resource cleanup failed');
    }
  }
  return {
    async detect(source) {
      if(disposed) throw new Error('Detector disposed');
      if(active)throw new Error('Detector busy');
      active=infer(source);
      try{return await active;}finally{active=null;}
    },
    dispose(){
      if(releasePromise)return releasePromise;
      disposed=true;
      const pending=active;
      releasePromise=(async()=>{try{if(pending)await pending;}catch{/* detect retains the inference failure */}finally{await session.release();}})();
      return releasePromise;
    }
  };
}
