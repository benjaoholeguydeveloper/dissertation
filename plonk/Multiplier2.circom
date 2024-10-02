/*
First, the pragma instruction is used to specify the compiler version. 
This is to ensure that the circuit is compatible with the compiler version indicated after the pragma instruction. 
Otherwise, the compiler will throw a warning.
*/
pragma circom 2.0.0;

/*This circuit template checks that c is the multiplication of a and b.*/  

template Multiplier2 () {  

   // Declaration of signals.  
   signal input a;  
   signal input b;  
   signal input expectedCube;

   signal calc;
   signal product;
   signal output c;  

   // Constraints.  
   calc <== a * b;  
   product <== calc * calc;
   c <== calc * product;
   expectedCube === c;
}

component main {public [expectedCube]} = Multiplier2();

