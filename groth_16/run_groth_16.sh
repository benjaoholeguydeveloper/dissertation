#!/bin/bash
set -evx

echo '###########################';
echo '#### COMPILE AND RUN #####';
echo '###########################';

echo "Compile Multiplier3 circuit";
circom Multiplier3.circom --r1cs --wasm --sym

echo "Multiplier3 circuit info"
snarkjs r1cs info Multiplier3.r1cs

# setup power of tau from preprepared
#cp preparedtau/pot14_0000.ptau demo1_js/pot14_0000.ptau
#cp preparedtau/pot14_0001.ptau demo1_js/pot14_0001.ptau
#cp preparedtau/pot14_beacon.ptau demo1_js/pot14_beacon.ptau
#cp preparedtau/pot14_final.ptau demo1_js/pot14_final.ptau

#copy compiled file
cp input.json Multiplier3_js
cp input.json Multiplier3_cpp
cp Multiplier3.r1cs Multiplier3_js
cp Multiplier3.r1cs Multiplier3_cpp

# generate witness from js
echo "Generate witness from js"

cd Multiplier3_js

node generate_witness.js Multiplier3.wasm input.json witness.wtns

# trusted setup phase1 - powers of tau

echo "Trusted setup phase1 - powers of tau"

snarkjs powersoftau new bn128 12 pot12_0000.ptau -v

snarkjs powersoftau contribute pot12_0000.ptau pot12_0001.ptau --name="First contribution" -v

# trusted setup phase2

echo "Trusted setup phase2 power of tau"

snarkjs powersoftau prepare phase2 pot12_0001.ptau pot12_final.ptau -v

snarkjs powersoftau contribute pot12_0001.ptau pot12_0002.ptau --name="Second contribution" -v -e="some random text"

snarkjs powersoftau export challenge pot12_0002.ptau challenge_0003
snarkjs powersoftau challenge contribute bn128 challenge_0003 response_0003 -e="some random text"
snarkjs powersoftau import response pot12_0002.ptau response_0003 pot12_0003.ptau -n="Third contribution name"

# verify the protocol
echo "Verify the protocol"
snarkjs powersoftau verify pot12_0003.ptau

# random beacon
echo "Random beacon"
snarkjs powersoftau beacon pot12_0003.ptau pot12_beacon.ptau 0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f 10 -n="Final Beacon"

# Prepare phase 2
echo "Random beacon"
snarkjs powersoftau prepare phase2 pot12_beacon.ptau pot12_final.ptau -v

# Verify final
echo "Verify final power of tau"
snarkjs powersoftau verify pot12_final.ptau


#setup groth16
echo "setup groth16"
snarkjs groth16 setup Multiplier3.r1cs pot12_final.ptau Multiplier3_final.zkey

#export the verification key
echo "export the verification key"
snarkjs zkey export verificationkey Multiplier3_final.zkey verification_key.json

# create proof groth16
echo "create proof groth16"
snarkjs groth16 prove Multiplier3_final.zkey witness.wtns proof.json public.json

# verify proof
echo "verify proof"
snarkjs groth16 verify verification_key.json public.json proof.json






