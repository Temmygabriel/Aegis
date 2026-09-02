def test_toolchain_works(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("intelligent-contracts/aegis.py")
    direct_vm.sender = direct_alice
    contract.register("smoke-agent")
    profile = contract.get_profile("smoke-agent")
    assert profile["tier"] == "unrated"
