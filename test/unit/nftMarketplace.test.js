const { assert, expect } = require("chai");
const { network, deployments, ethers, getNamedAccounts } = require("hardhat");
const { developmentChains } = require("../../helper-hardhat-config");

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Nft Marketplace Tests", () => {
          let nftMarketplace, nftMarketplaceContract, basicNft, basicNftContract;
          const PRICE = ethers.utils.parseEther("0.1");
          const TOKEN_ID = 0;

          beforeEach(async () => {
              accounts = await ethers.getSigners();
              deployer = accounts[0];
              user = accounts[1];
              await deployments.fixture(["all"]);
              nftMarketplaceContract = await ethers.getContract("NftMarketplace");
              nftMarketplace = nftMarketplaceContract.connect(deployer);
              basicNftContract = await ethers.getContract("BasicNft");
              basicNft = await basicNftContract.connect(deployer);
              await basicNft.mintNft();
              await basicNft.approve(nftMarketplace.address, TOKEN_ID);
          });

          describe("listItem", () => {
              it("emits an event after listing an item", async () => {
                  expect(await nftMarketplace.listItem(basicNft.address, TOKEN_ID, PRICE)).to.emit(
                      "ItemListed"
                  );
              });
              it("exclusively items that haven't been listed", async () => {
                  await nftMarketplace.listItem(basicNft.address, TOKEN_ID, PRICE);
                  const error = `NftMarketplace__AlreadyListed("${basicNft.address}", ${TOKEN_ID})`;

                  await expect(
                      nftMarketplace.listItem(basicNft.address, TOKEN_ID, PRICE)
                  ).to.be.revertedWith(error);
              });

              it("exclusively allows owners to list", async () => {
                  nftMarketplace = nftMarketplaceContract.connect(user);
                  await basicNft.approve(user.address, TOKEN_ID);
                  await expect(
                      nftMarketplace.listItem(basicNft.address, TOKEN_ID, PRICE)
                  ).to.be.revertedWith("NotOwner");
              });

              it("needs approvals to list item", async () => {
                  await basicNft.approve(ethers.constants.AddressZero, TOKEN_ID);
                  await expect(
                      nftMarketplace.listItem(basicNft.address, TOKEN_ID, PRICE)
                  ).to.be.revertedWith("NotApprovedForMarketplace");
              });

              it("Updates listing with seller and price", async () => {
                  await nftMarketplace.listItem(basicNft.address, TOKEN_ID, PRICE);
                  const listing = await nftMarketplace.getListing(basicNft.address, TOKEN_ID);
                  assert.equal(listing.price.toString(), PRICE);
                  assert.equal(listing.seller, deployer.address);
              });

              it("Reverts if price is 0", async () => {
                  await expect(
                      nftMarketplace.listItem(basicNft.address, TOKEN_ID, 0)
                  ).to.be.revertedWith("NotApprovedForMarketplace");
              });
          });

          describe("cancelListing", () => {
              it("reverts if there is no listing", async () => {
                  const error = `NotListed("${basicNft.address}", ${TOKEN_ID})`;
                  await expect(
                      nftMarketplace.cancelListing(basicNft.address, TOKEN_ID)
                  ).to.be.revertedWith(error);
              });

              it("reverts if anyone but the owner tries to call", async () => {
                  await nftMarketplace.listItem(basicNft.address, TOKEN_ID, PRICE);
                  nftMarketplace = await nftMarketplaceContract.connect(user);
                  await basicNft.approve(user.address, TOKEN_ID);
                  await expect(
                      nftMarketplace.cancelListing(basicNft.address, TOKEN_ID)
                  ).to.be.revertedWith("NotOwner");
              });

              it("emits event and removes listing", async () => {
                  await nftMarketplace.listItem(basicNft.address, TOKEN_ID, PRICE);
                  expect(await nftMarketplace.cancelListing(basicNft.address, TOKEN_ID)).to.emit(
                      "ItemCancel"
                  );
                  const listing = await nftMarketplace.getListing(basicNft.address, TOKEN_ID);
                  console.log("Listing", listing.price.toString());
                  assert.equal(listing.price.toString(), "0");
              });
          });
          describe("buyItem", () => {
              it("reverts if not listed", async () => {
                  await expect(
                      nftMarketplace.buyItem(basicNft.address, TOKEN_ID)
                  ).to.be.revertedWith("NotListed");
              });

              it("reverts if price is not met", async () => {
                  await nftMarketplace.listItem(basicNft.address, TOKEN_ID, PRICE);
                  await expect(
                      nftMarketplace.buyItem(basicNft.address, TOKEN_ID)
                  ).to.be.revertedWith(
                      `PriceNotMet("${basicNft.address}", ${TOKEN_ID}, ${PRICE})`
                  );
              });

              it("transfers the nft to the buyer and updates internal proceeds record", async () => {
                  await nftMarketplace.listItem(basicNft.address, TOKEN_ID, PRICE);
                  nftMarketplace = nftMarketplaceContract.connect(user);
                  expect(
                      await nftMarketplace.buyItem(basicNft.address, TOKEN_ID, { value: PRICE })
                  ).to.emit("ItemBought");

                  const newOwner = await basicNft.ownerOf(TOKEN_ID);
                  const sellerProceed = await nftMarketplace.getProceeds(deployer.address);

                  assert.equal(newOwner.toString(), user.address);
                  assert.equal(sellerProceed.toString(), PRICE);
              });
          });

          describe("updateListing", () => {
              it("Must be owner and listed", async () => {
                  await expect(
                      nftMarketplace.updateListing(basicNft.address, TOKEN_ID, PRICE)
                  ).to.be.revertedWith(`NotListed("${basicNft.address}", ${TOKEN_ID})`);
                  await nftMarketplace.listItem(basicNft.address, TOKEN_ID, PRICE);
                  nftMarketplace = nftMarketplaceContract.connect(user);
                  await expect(
                      nftMarketplace.updateListing(basicNft.address, TOKEN_ID, PRICE)
                  ).to.be.revertedWith("NotOwner");
              });

              it("Updates the price and emits an event", async () => {
                  const updatedPrice = ethers.utils.parseEther("0.2");
                  await nftMarketplace.listItem(basicNft.address, TOKEN_ID, PRICE);
                  expect(
                      await nftMarketplace.updateListing(basicNft.address, TOKEN_ID, updatedPrice)
                  ).to.emit("ItemListed");
                  const listing = await nftMarketplace.getListing(basicNft.address, TOKEN_ID);
                  assert.equal(listing.price.toString(), updatedPrice);
              });
          });

          describe("withdrawProceeds", () => {
              it("reverts if there is no proceeds", async () => {
                  await expect(nftMarketplace.withdrawProceeds()).to.be.revertedWith("NoProceeds");
              });

              it("withdraws proceeds", async () => {
                  await nftMarketplace.listItem(basicNft.address, TOKEN_ID, PRICE);
                  nftMarketplace = nftMarketplaceContract.connect(user);
                  await nftMarketplace.buyItem(basicNft.address, TOKEN_ID, { value: PRICE });
                  nftMarketplace = nftMarketplaceContract.connect(deployer);

                  const deployerProceedsBefore = await nftMarketplace.getProceeds(
                      deployer.address
                  );
                  const deployerBalanceBefore = await deployer.getBalance();

                  const tx = await nftMarketplace.withdrawProceeds();
                  const receipt = await tx.wait(1);
                  const { gasUsed, effectiveGasPrice } = receipt;
                  const gasCost = gasUsed.mul(effectiveGasPrice);
                  const deployerBalanceAfter = await deployer.getBalance();

                  assert.equal(
                      deployerBalanceAfter.add(gasCost).toString(),
                      deployerProceedsBefore.add(deployerBalanceBefore).toString()
                  );
              });
          });
      });
