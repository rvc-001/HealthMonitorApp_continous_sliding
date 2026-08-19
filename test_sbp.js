const ort = require('onnxruntime-node');

async function testExactInputs() {
  const session = await ort.InferenceSession.create('public/models/sbp_model.onnx');
  
  // Try to reconstruct the EXACT final_features array for Segment 0 using the polynomial features
  const poly0 = [-0.777, -0.010, -0.097, -0.253, 1.174, -0.457, -61.989, 0.011, 0.035, 0.161, 0.228, 0.063, -0.012, -0.000, 0.005]; // I'm guessing the last 5 values? 
  // Wait, I can just load the config and calculate it!
  const fs = require('fs');
  const config = JSON.parse(fs.readFileSync('public/models/production_config.json', 'utf8'));
  const sbpConf = config.targets.sbp;
  
  const scaler2_mean = sbpConf.scaler2.mean;
  const scaler2_scale = sbpConf.scaler2.scale;
  
  // Segment 0 polynomial features from user log:
  // [ "-0.777", "-0.010", "-0.097", "-0.253", "1.174", "-0.457", "-61.989", "0.011", "0.035", "0.161", … ]
  // We can't know the last 5 exactly, but we can check if running the SAME session twice with slightly different inputs caches the output?
  
  const tensor1 = new ort.Tensor('float32', new Float32Array(15).fill(0), [1, 15]);
  const res1 = await session.run({ [session.inputNames[0]]: tensor1 });
  
  const tensor2 = new ort.Tensor('float32', new Float32Array(15).fill(1), [1, 15]);
  const res2 = await session.run({ [session.inputNames[0]]: tensor2 });
  
  console.log('Res1:', res1[session.outputNames[0]].data[0]);
  console.log('Res2:', res2[session.outputNames[0]].data[0]);
}
testExactInputs();
