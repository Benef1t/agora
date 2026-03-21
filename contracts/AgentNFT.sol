// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AgentNFT
 * @dev ERC-1155 NFT for Web3 Agora agent certification tiers.
 *      Token IDs: 1=Bronze, 2=Silver, 3=Gold, 4=Genesis
 *      Only the owner (deployer) can mint.
 */
contract AgentNFT is ERC1155, Ownable {
    string public name = "Web3 Agora Agent";
    string public symbol = "AGORA";

    constructor() ERC1155("https://agora.web3/{id}.json") Ownable(msg.sender) {}

    function mint(address to, uint256 id, uint256 amount, bytes memory data) external onlyOwner {
        _mint(to, id, amount, data);
    }

    function mintBatch(address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data) external onlyOwner {
        _mintBatch(to, ids, amounts, data);
    }
}
