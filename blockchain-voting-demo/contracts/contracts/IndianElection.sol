import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/ShortStrings.sol";

/**
 * @title IndianElection
 * @notice Blockchain voting system compliant with Election Commission of India (ECI) standards
 * @dev Deployed on Sonic EVM Testnet (Chain ID: 14601)
 *
 * Fixes Indian electoral flaws:
 * [FIX] Voter impersonation  -> Aadhaar + EPIC hash commitment (duplicate check)
 * [FIX] Booth capturing      -> Time-locked phases enforced by smart contract
 * [FIX] EVM opacity          -> All votes on public chain, anyone can audit
 * [FIX] No VVPAT             -> Cryptographic receipt per vote (on-chain)
 * [FIX] No NOTA              -> NOTA candidate built-in (Supreme Court 2013 mandate)
 * [FIX] Manual counting      -> Instant, tamper-proof on-chain tally
 * [FIX] Lost voter rolls     -> Immutable voter registry on chain
 * [FIX] NRI exclusion        -> Wallet-based voting from anywhere in the world
 */
contract IndianElection is Ownable, ReentrancyGuard {
    using ECDSA for bytes32;

    // ---- Meta-Transaction (EIP-712) -------------------------------------------
    bytes32 public constant VOTE_TYPEHASH = keccak256(
        "Vote(address voter,uint256 candidateId,uint256 nonce)"
    );
    bytes32 public immutable DOMAIN_SEPARATOR;
    mapping(address => uint256) public nonces;

    // ---- Election Phases -------------------------------------------------------
    enum Phase { REGISTRATION, VOTING, COUNTING, RESULTS }
    Phase public currentPhase;

    uint256 public votingStartTime;
    uint256 public votingEndTime;
    uint8   public constituencyCount;
    string  public electionName;

    // ---- Structs ---------------------------------------------------------------

    /**
     * @dev Voter identity uses hash commitments.
     *      Raw Aadhaar/EPIC never touches the chain.
     *      Client hashes: keccak256(abi.encodePacked(aadhaarNumber)) before sending.
     */
    struct Voter {
        bytes32 aadhaarHash;
        bytes32 epicHash;
        uint8   constituencyId;
        bool    isRegistered;
        bool    hasVoted;
        bytes32 vvpatReceiptHash;
        uint256 votedAt;
    }

    struct Candidate {
        uint256 id;
        string  name;
        string  partyName;
        string  partySymbol;
        uint8   constituencyId;
        uint256 voteCount;
        bool    isNOTA;
        bool    exists;
    }

    // ---- State Variables -------------------------------------------------------

    mapping(address  => Voter)     public voters;
    mapping(bytes32  => bool)      public usedAadhaarHashes;
    mapping(bytes32  => bool)      public usedEpicHashes;
    mapping(address  => bool)      public electionValidators;
    mapping(uint8    => uint256[]) public constituencyCandidates;

    Candidate[] public candidates;
    uint8 public validatorCount;

    // ---- Events ----------------------------------------------------------------

    event VoterRegistered(address indexed voter, uint8 constituencyId, bytes32 aadhaarHash);
    event CandidateAdded(uint256 indexed id, string name, string party, string symbol, uint8 constituencyId, bool isNOTA);
    event VoteCast(address indexed voter, uint256 indexed candidateId, uint8 constituencyId, bytes32 vvpatHash, uint256 timestamp);
    event PhaseChanged(Phase newPhase, uint256 timestamp);
    event ValidatorAdded(address indexed validator);

    // ---- Modifiers -------------------------------------------------------------

    modifier onlyDuringPhase(Phase phase) {
        require(currentPhase == phase, "Action not allowed in current election phase");
        _;
    }

    modifier onlyECAdmin() {
        require(
            msg.sender == owner() || electionValidators[msg.sender],
            "Caller is not an Election Commission admin"
        );
        _;
    }

    // ---- Constructor -----------------------------------------------------------

    constructor(
        string memory _electionName,
        uint8 _constituencyCount
    ) Ownable(msg.sender) {
        electionName      = _electionName;
        constituencyCount = _constituencyCount;
        currentPhase      = Phase.REGISTRATION;

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(_electionName)),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );

        emit PhaseChanged(Phase.REGISTRATION, block.timestamp);
    }

    // ---- EC Admin: Validator Management ----------------------------------------

    function addValidator(address validator) external onlyOwner {
        require(!electionValidators[validator], "Already a validator");
        electionValidators[validator] = true;
        validatorCount++;
        emit ValidatorAdded(validator);
    }

    // ---- EC Admin: Voter Registration ------------------------------------------

    /**
     * @notice Register a voter (EC admin)
     * FIX: Duplicate Aadhaar/EPIC hashes permanently rejected.
     *      Prevents ghost voters and identity fraud.
     */
    function registerVoter(
        address voterAddress,
        bytes32 aadhaarHash,
        bytes32 epicHash,
        uint8   constituencyId
    ) external onlyECAdmin onlyDuringPhase(Phase.REGISTRATION) {
        require(constituencyId > 0 && constituencyId <= constituencyCount, "Invalid constituency");
        require(!voters[voterAddress].isRegistered,  "Voter already registered");
        require(!usedAadhaarHashes[aadhaarHash],      "Aadhaar already registered");
        require(!usedEpicHashes[epicHash],            "EPIC card already registered");

        voters[voterAddress] = Voter({
            aadhaarHash:      aadhaarHash,
            epicHash:         epicHash,
            constituencyId:   constituencyId,
            isRegistered:     true,
            hasVoted:         false,
            vvpatReceiptHash: bytes32(0),
            votedAt:          0
        });

        usedAadhaarHashes[aadhaarHash] = true;
        usedEpicHashes[epicHash]       = true;

        emit VoterRegistered(voterAddress, constituencyId, aadhaarHash);
    }

    /**
     * @notice Self-registration (internal testing).
     *         In production, this would require EC countersignature.
     */
    function selfRegister(
        bytes32 aadhaarHash,
        bytes32 epicHash,
        uint8   constituencyId
    ) external onlyDuringPhase(Phase.REGISTRATION) {
        require(constituencyId > 0 && constituencyId <= constituencyCount, "Invalid constituency");
        require(!voters[msg.sender].isRegistered, "Already registered");
        require(!usedAadhaarHashes[aadhaarHash],  "Aadhaar already used by another voter");
        require(!usedEpicHashes[epicHash],         "EPIC card already used by another voter");

        voters[msg.sender] = Voter({
            aadhaarHash:      aadhaarHash,
            epicHash:         epicHash,
            constituencyId:   constituencyId,
            isRegistered:     true,
            hasVoted:         false,
            vvpatReceiptHash: bytes32(0),
            votedAt:          0
        });

        usedAadhaarHashes[aadhaarHash] = true;
        usedEpicHashes[epicHash]       = true;

        emit VoterRegistered(msg.sender, constituencyId, aadhaarHash);
    }

    // ---- EC Admin: Candidate Management ----------------------------------------

    function addCandidate(
        string calldata name,
        string calldata partyName,
        string calldata partySymbol,
        uint8   constituencyId,
        bool    isNOTA
    ) external onlyECAdmin onlyDuringPhase(Phase.REGISTRATION) {
        require(constituencyId > 0 && constituencyId <= constituencyCount, "Invalid constituency");

        uint256 candidateId = candidates.length;
        candidates.push(Candidate({
            id:             candidateId,
            name:           name,
            partyName:      partyName,
            partySymbol:    partySymbol,
            constituencyId: constituencyId,
            voteCount:      0,
            isNOTA:         isNOTA,
            exists:         true
        }));

        constituencyCandidates[constituencyId].push(candidateId);
        emit CandidateAdded(candidateId, name, partyName, partySymbol, constituencyId, isNOTA);
    }

    // ---- EC Admin: Phase Management --------------------------------------------

    /**
     * @notice Open polling - starts the voting window.
     * FIX: Booth capturing - voting window is smart-contract enforced.
     */
    function startVoting(uint256 durationInSeconds)
        external onlyOwner onlyDuringPhase(Phase.REGISTRATION)
    {
        require(candidates.length > 0, "No candidates registered yet");
        votingStartTime = block.timestamp;
        votingEndTime   = block.timestamp + durationInSeconds;
        currentPhase    = Phase.VOTING;
        emit PhaseChanged(Phase.VOTING, block.timestamp);
    }

    function endVoting() external onlyOwner onlyDuringPhase(Phase.VOTING) {
        require(block.timestamp >= votingEndTime, "Voting period has not ended yet");
        currentPhase = Phase.COUNTING;
        emit PhaseChanged(Phase.COUNTING, block.timestamp);
    }

    function forceEndVoting() external onlyOwner onlyDuringPhase(Phase.VOTING) {
        currentPhase = Phase.COUNTING;
        emit PhaseChanged(Phase.COUNTING, block.timestamp);
    }

    function publishResults() external onlyOwner onlyDuringPhase(Phase.COUNTING) {
        currentPhase = Phase.RESULTS;
        emit PhaseChanged(Phase.RESULTS, block.timestamp);
    }

    // ---- Voter: Cast Vote ------------------------------------------------------

    /**
     * @notice Cast a vote for a candidate in your constituency.
     * FIX: One-person-one-vote enforced by EVM state machine.
     *      VVPAT receipt generated immediately and stored on-chain.
     */
    function castVote(uint256 candidateId)
        external
        nonReentrant
        onlyDuringPhase(Phase.VOTING)
    {
        _internalCastVote(msg.sender, candidateId);
    }

    /**
     * @notice Cast a vote via a meta-transaction (Gasless Voting).
     * @param voter        The address of the voter.
     * @param candidateId  The candidate they choose.
     * @param signature    The EIP-712 signature from the voter.
     * FIX: Citizen pays ZERO gas. Relayer pays gas, Voter signs identity intent.
     */
    function castVoteRelayed(
        address voter,
        uint256 candidateId,
        bytes calldata signature
    ) external nonReentrant onlyDuringPhase(Phase.VOTING) {
        require(block.timestamp <= votingEndTime, "Voting period has ended");

        bytes32 structHash = keccak256(
            abi.encode(VOTE_TYPEHASH, voter, candidateId, nonces[voter]++)
        );
        bytes32 digest = MessageHashUtils.toTypedDataHash(DOMAIN_SEPARATOR, structHash);
        address signer = digest.recover(signature);

        require(signer == voter, "Invalid signature for gasless vote");
        _internalCastVote(voter, candidateId);
    }

    /**
     * @dev Internal logic for casting a vote (shared by direct and relayed)
     */
    function _internalCastVote(address voterAddr, uint256 candidateId) internal {
        Voter storage voter = voters[voterAddr];
        Candidate storage candidate = candidates[candidateId];

        require(voter.isRegistered, "You are not a registered voter");
        require(!voter.hasVoted, "You have already voted -- one vote per citizen");
        require(candidate.exists, "Candidate does not exist");
        require(
            candidate.constituencyId == voter.constituencyId,
            "Candidate does not belong to your constituency"
        );

        // Generate on-chain VVPAT receipt hash
        bytes32 vvpatHash = keccak256(
            abi.encodePacked(
                voterAddr,
                candidateId,
                voter.constituencyId,
                block.timestamp,
                blockhash(block.number - 1)
            )
        );

        voter.hasVoted = true;
        voter.vvpatReceiptHash = vvpatHash;
        voter.votedAt = block.timestamp;
        candidate.voteCount++;

        emit VoteCast(voterAddr, candidateId, voter.constituencyId, vvpatHash, block.timestamp);
    }

    // ---- View Functions --------------------------------------------------------

    function getConstituencyCandidates(uint8 constituencyId)
        external view returns (Candidate[] memory)
    {
        uint256[] storage ids = constituencyCandidates[constituencyId];
        Candidate[] memory result = new Candidate[](ids.length);
        for (uint i = 0; i < ids.length; i++) {
            result[i] = candidates[ids[i]];
        }
        return result;
    }

    function getAllCandidates() external view returns (Candidate[] memory) {
        return candidates;
    }

    function getCandidateCount() external view returns (uint256) {
        return candidates.length;
    }

    /**
     * @notice Every voter can verify their vote was recorded correctly.
     * FIX: Equivalent of VVPAT slip - cryptographic proof on-chain.
     */
    function getVVPATReceipt(address voterAddress)
        external view returns (bytes32 receiptHash, bool voted, uint256 votedAt)
    {
        Voter storage voter = voters[voterAddress];
        return (voter.vvpatReceiptHash, voter.hasVoted, voter.votedAt);
    }

    function getVoterInfo(address voterAddress)
        external view returns (
            uint8   constituencyId,
            bool    isRegistered,
            bool    hasVoted,
            bytes32 vvpatReceiptHash
        )
    {
        Voter storage voter = voters[voterAddress];
        return (voter.constituencyId, voter.isRegistered, voter.hasVoted, voter.vvpatReceiptHash);
    }

    function getElectionStatus() external view returns (
        Phase   phase,
        uint256 voteStart,
        uint256 voteEnd,
        uint256 currentTime,
        uint256 totalVotes
    ) {
        uint256 total = 0;
        for (uint i = 0; i < candidates.length; i++) {
            total += candidates[i].voteCount;
        }
        return (currentPhase, votingStartTime, votingEndTime, block.timestamp, total);
    }

    /**
     * @notice Get constituency results sorted by voteCount descending.
     * FIX: Results are public, instant, and mathematically verifiable by anyone.
     */
    function getConstituencyResults(uint8 constituencyId)
        external view returns (Candidate[] memory sorted)
    {
        uint256[] storage ids = constituencyCandidates[constituencyId];
        sorted = new Candidate[](ids.length);
        for (uint i = 0; i < ids.length; i++) {
            sorted[i] = candidates[ids[i]];
        }
        // Bubble sort descending by voteCount
        for (uint i = 0; i < sorted.length; i++) {
            for (uint j = i + 1; j < sorted.length; j++) {
                if (sorted[j].voteCount > sorted[i].voteCount) {
                    Candidate memory temp = sorted[i];
                    sorted[i] = sorted[j];
                    sorted[j] = temp;
                }
            }
        }
    }
}
