var SimpleMultiSig = artifacts.require("./SimpleMultiSig.sol")
var TestRegistry = artifacts.require("./TestRegistry.sol")
var lightwallet = require('eth-lightwallet')
const Promise = require('bluebird')
const BigNumber = require('bignumber.js')

const web3SendTransaction = Promise.promisify(web3.eth.sendTransaction)
const web3GetBalance = Promise.promisify(web3.eth.getBalance)

let DOMAIN_SEPARATOR = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const TXTYPE_HASH = '0xe7beff35c01d1bb188c46fbae3d80f308d2600ba612c687a3e61446e0dffda0b'
const NAME_HASH = '0xb7a0bfa1b79f2443f4d73ebb9259cddbcd510b18be6fc4da7d1aa7b1786e73e6'
const VERSION_HASH = '0xc89efdaa54c0f20c7adf612882df0950f5a951637e0307cdcb4c672f298b8bc6'
const EIP712DOMAIN_HASH = '0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f'


contract('SimpleMultiSig', function(accounts) {

  let keyFromPw
  let acct
  let lw

  let createSigs = function(signers, multisigAddr, nonce, destinationAddr, value, data) {

    let txInput = TXTYPE_HASH + destinationAddr.slice(2).padStart(64, '0') + value.toString('16').padStart(64, '0') + web3.sha3(data, {encoding: 'hex'}).slice(2) + nonce.toString('16').padStart(64, '0')
    let txInputHash = web3.sha3(txInput, {encoding: 'hex'})
    
    let input = '0x19' + '01' + DOMAIN_SEPARATOR.slice(2) + txInputHash.slice(2)
    let hash = web3.sha3(input, {encoding: 'hex'})
    
    let sigV = []
    let sigR = []
    let sigS = []

    for (var i=0; i<signers.length; i++) {
      let sig = lightwallet.signing.signMsgHash(lw, keyFromPw, hash, signers[i])
      sigV.push(sig.v)
      sigR.push('0x' + sig.r.toString('hex'))
      sigS.push('0x' + sig.s.toString('hex'))
    }

    return {sigV: sigV, sigR: sigR, sigS: sigS}

  }

  let executeSendSuccess = async function(owners, threshold, signers, done) {

    let multisig = await SimpleMultiSig.new(threshold, owners, {from: accounts[0]})

    let randomAddr = web3.sha3(Math.random().toString()).slice(0,42)

    // Receive funds
    await web3SendTransaction({from: accounts[0], to: multisig.address, value: web3.toWei(new BigNumber(0.1), 'ether')})

    let nonce = await multisig.nonce.call()
    assert.equal(nonce.toNumber(), 0)

    let bal = await web3GetBalance(multisig.address)
    assert.equal(bal, web3.toWei(0.1, 'ether'))

    // check that owners are stored correctly
    for (var i=0; i<owners.length; i++) {
      let ownerFromContract = await multisig.ownersArr.call(i)
      assert.equal(owners[i], ownerFromContract)
    }

    let value = web3.toWei(new BigNumber(0.01), 'ether')

    let sigs = createSigs(signers, multisig.address, nonce, randomAddr, value, '')

    await multisig.execute(sigs.sigV, sigs.sigR, sigs.sigS, randomAddr, value, '', {from: accounts[0], gasLimit: 1000000})

    // Check funds sent
    bal = await web3GetBalance(randomAddr)
    assert.equal(bal.toString(), value.toString())

    // Check nonce updated
    nonce = await multisig.nonce.call()
    assert.equal(nonce.toNumber(), 1)

    // Send again
    sigs = createSigs(signers, multisig.address, nonce, randomAddr, value, '')
    await multisig.execute(sigs.sigV, sigs.sigR, sigs.sigS, randomAddr, value, '', {from: accounts[0], gasLimit: 1000000})

    // Check funds
    bal = await web3GetBalance(randomAddr)
    assert.equal(bal.toString(), (value*2).toString())

    // Check nonce updated
    nonce = await multisig.nonce.call()
    assert.equal(nonce.toNumber(), 2)

    // Test contract interactions
    let reg = await TestRegistry.new({from: accounts[0]})

    let number = 12345
    let data = lightwallet.txutils._encodeFunctionTxData('register', ['uint256'], [number])

    sigs = createSigs(signers, multisig.address, nonce, reg.address, value, data)
    await multisig.execute(sigs.sigV, sigs.sigR, sigs.sigS, reg.address, value, data, {from: accounts[0], gasLimit: 1000000})

    // Check that number has been set in registry
    let numFromRegistry = await reg.registry(multisig.address)
    assert.equal(numFromRegistry.toNumber(), number)

    // Check funds in registry
    bal = await web3GetBalance(reg.address)
    assert.equal(bal.toString(), value.toString())

    // Check nonce updated
    nonce = await multisig.nonce.call()
    assert.equal(nonce.toNumber(), 3)

    done()
  }

  let executeSendFailure = async function(owners, threshold, signers, done) {

    let multisig = await SimpleMultiSig.new(threshold, owners, {from: accounts[0]})

    let nonce = await multisig.nonce.call()
    assert.equal(nonce.toNumber(), 0)

    // Receive funds
    await web3SendTransaction({from: accounts[0], to: multisig.address, value: web3.toWei(new BigNumber(2), 'ether')})

    let randomAddr = web3.sha3(Math.random().toString()).slice(0,42)
    let value = web3.toWei(new BigNumber(0.1), 'ether')
    let sigs = createSigs(signers, multisig.address, nonce, randomAddr, value, '')

    let errMsg = ''
    try {
    await multisig.execute(sigs.sigV, sigs.sigR, sigs.sigS, randomAddr, value, '', {from: accounts[0], gasLimit: 1000000})
    }
    catch(error) {
      errMsg = error.message
    }

    assert.equal(errMsg, 'VM Exception while processing transaction: revert', 'Test did not throw')

    done()
  }

  let creationFailure = async function(owners, threshold, done) {

    try {
      await SimpleMultiSig.new(threshold, owners, {from: accounts[0]})
    }
    catch(error) {
      errMsg = error.message
    }

    assert.equal(errMsg, 'VM Exception while processing transaction: revert', 'Test did not throw')

    done()
  }
  
  before((done) => {

    let seed = "pull rent tower word science patrol economy legal yellow kit frequent fat"

    lightwallet.keystore.createVault(
    {hdPathString: "m/44'/60'/0'/0",
     seedPhrase: seed,
     password: "test",
     salt: "testsalt"
    },
    function (err, keystore) {

      lw = keystore
      lw.keyFromPassword("test", function(e,k) {
        keyFromPw = k

        lw.generateNewAddress(keyFromPw, 20)
        let acctWithout0x = lw.getAddresses()
        acct = acctWithout0x.map((a) => {return a})
        acct.sort()
        done()
      })
    })
  })

  describe("3 signers, threshold 2", () => {

    it("should succeed with signers 0, 1", (done) => {
      let signers = [acct[0], acct[1]]
      signers.sort()
      executeSendSuccess(acct.slice(0,3), 2, signers, done)
    })

    it("should succeed with signers 0, 2", (done) => {
      let signers = [acct[0], acct[2]]
      signers.sort()
      executeSendSuccess(acct.slice(0,3), 2, signers, done)
    })

    it("should succeed with signers 1, 2", (done) => {
      let signers = [acct[1], acct[2]]
      signers.sort()
      executeSendSuccess(acct.slice(0,3), 2, signers, done)
    })

    it("should fail due to non-owner signer", (done) => {
      let signers = [acct[0], acct[3]]
      signers.sort()
      executeSendFailure(acct.slice(0,3), 2, signers, done)
    })

    it("should fail with more signers than threshold", (done) => {
      executeSendFailure(acct.slice(0,3), 2, acct.slice(0,3), done)
    })

    it("should fail with fewer signers than threshold", (done) => {
      executeSendFailure(acct.slice(0,3), 2, [acct[0]], done)
    })

    it("should fail with one signer signing twice", (done) => {
      executeSendFailure(acct.slice(0,3), 2, [acct[0], acct[0]], done)
    })

    it("should fail with signers in wrong order", (done) => {
      let signers = [acct[0], acct[1]]
      signers.sort().reverse() //opposite order it should be
      executeSendFailure(acct.slice(0,3), 2, signers, done)
    })

  })  

  describe("Edge cases", () => {
    it("should succeed with 10 owners, 10 signers", (done) => {
      executeSendSuccess(acct.slice(0,10), 10, acct.slice(0,10), done)
    })

    it("should fail to create with signers 0, 0, 2, and threshold 3", (done) => { 
      creationFailure([acct[0],acct[0],acct[2]], 3, done)
    })

    it("should fail with 0 signers", (done) => {
      executeSendFailure(acct.slice(0,3), 2, [], done)
    })

    it("should fail with 11 owners", (done) => {
      creationFailure(acct.slice(0,11), 2, done)
    })
  })

  describe("Hash constants", () => {
    it("uses correct hash for EIP712DOMAIN", (done) => {
      const eip712DomainType = 'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'
      assert.equal(web3.sha3(eip712DomainType), EIP712DOMAIN_HASH)
      done()
    })

    it("uses correct hash for NAME", (done) => {
      assert.equal(web3.sha3('Simple MultiSig'), NAME_HASH)
      done()
    })

    it("uses correct hash for VERSION", (done) => {
      assert.equal(web3.sha3('1'), VERSION_HASH)
      done()
    })

    it("uses correct hash for MULTISIGTX", (done) => {
      const multiSigTxType = 'MultiSigTransaction(address destination,uint256 value,bytes data,uint256 nonce)'
      assert.equal(web3.sha3(multiSigTxType), TXTYPE_HASH)
      done()
    })
  })

  
})
