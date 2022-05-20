pragma solidity ^0.6.11;

interface ERC20 {
    function transfer(address _to, uint _value) public returns (bool success);
    function approve(address _spender, uint _value) public returns (bool success);
}

interface cERC20 {
  function mint(uint mintAmount) returns (uint)
  function redeem(uint redeemTokens) returns (uint)
}

interface Comptroller {
  function claimComp(address holder) public
}

contract Pusher {
  cERC20 constant cUSDC = cERC20(0x39aa39c021dfbae8fac545936693ac917d5e7563);
  ERC20 constant USDC = ERC20(0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48);
  ERC20 constant COMP = ERC20(0xc00e94cb662c3520282e6f5717214004a7f26888);
  comptroller constant comptroller = Comptroller(0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b);

  address immutable _owner;

  mapping (address => uint) withdrawalAddresses;
  mapping (address => uint) compWithdrawalAddresses;

  constructor(address owner) {
    USDC.approve(address(cUSDC), -1);
    owner = _owner;
  }

  function push() {
    cUSDC.mint(USDC.balanceOf(address(this)));
  }
  
  // deal with exchange rate on signing client
  function withdrawTo(uint amount, uint amountCtokens, address recipient) {
    require(msg.sender == owner);
    require(withdrawalAddresses[recipient] > block.timestamp - 24 hours);
    cUSDC.redeem(amountCtokens);
    USDC.transfer(recipient, amount);
  }

  function withdrawCompTo(address recipient) {
    require(msg.sender == owner);
    require(compWithdrawalAddresses[recipient] > block.timestamp - 24 hours);
    comptroller.claimComp();
    COMP.transfer(recipient, COMP.balanceOf(address(this)));
  }

  function addWithdrawalAddress(address recipient) {
    require(msg.sender == owner);
    withdrawalAddresses[recipient] = block.timestamp;
  }

  function addCompWithdrawalAddress(address recipient) {
    require(msg.sender == owner);
    compWithdrawalAddresses[recipient] = block.timestamp;
  }
  
  function removeWithdrawalAddress(address recipient) {
    require(msg.sender == owner);
    delete withdrawalAddresses[recipient];
  }

  function addCompWithdrawalAddress(address recipient) {
    require(msg.sender == owner);
    delete compWithdrawalAddresses[recipient];
  }
}