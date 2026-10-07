// Test data shared by the test files.

/** A known mainnet invoice from the sibling's published tests (two hints, one Spark marker). */
export const REAL_PAYMENT = {
  bolt11:
    'lnbc286050n1p4tetxlpp524jfexmca98flrqzdqrwxt5n7lzwwv8x77mckzw4ajstwsmex2gqsp52u00ael68v8yrt2cms6pyj93ftgyy9n6rk7lren03p52hjs5jwjsxq9z0rgqnp4qvyndeaqzman7h898jxm98dzkm0mlrsx36s93smrur7h0azyyuxc5rzjqwghf7zxvfkxq5a6sr65g0gdkv768p83mhsnt0msszapamzx2qvuxqqqqrt49lmtcqqqqqqqqqqq86qq9qrzjq0qvdqygawseu8s2x34fl63ss3pxfy66tjy5z88q649jtc8ymz4wfapyqr6zgqqqq8hxk2qqae4jsqyugqcqzpudz82pshjgr5dus9wctvd3jhggr0vcs9xct5daeks6fqw4ek2u36yp68yctswpjkgunfvgcnxdc9qyyssq5eaumrd9727u9eyef3lds7jpxcfyzftuaay09rg277l5jlqxp2ms4n4qmxtlquazs5x5gpzwk73s3lrwpy69qwyzezn42samqgn906qq7c4qfm',
  paymentHash: '55649c9b78e94e9f8c026806e32e93f7c4e730e6f7b78b09d5eca0b743793290',
  nodeId: '030936e7a016fb3f5ce53c8db29da2b6dfbf8e068ea058c363e0fd77f444270d8a',
};

/** The node that signed all BOLT #11 spec test vectors. */
export const SPEC_NODE_ID = '03e7156ae33b0a208d0744199163177e909e80176e55d97a2f221ede0f934dd9ad';
export const SPEC_PAYMENT_HASH = '0001020304050607080900010203040506070809000102030405060708090102';

/** Valid BOLT #11 spec vectors (the node id is recovered from the signature). */
export const SPEC_VALID = [
  {
    bolt11:
      'lnbc1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq9qrsgq357wnc5r2ueh7ck6q93dj32dlqnls087fxdwk8qakdyafkq3yap9us6v52vjjsrvywa6rt52cm9r9zqt8r2t7mlcwspyetp5h2tztugp9lfyql',
    amountMsat: null,
    description: 'Please consider supporting this project',
    paymentHash: SPEC_PAYMENT_HASH,
  },
  {
    bolt11:
      'lnbc2500u1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpu9qrsgquk0rl77nj30yxdy8j9vdx85fkpmdla2087ne0xh8nhedh8w27kyke0lp53ut353s06fv3qfegext0eh0ymjpf39tuven09sam30g4vgpfna3rh',
    amountMsat: 250000000n,
    description: '1 cup coffee',
    paymentHash: SPEC_PAYMENT_HASH,
  },
  {
    bolt11:
      'lnbc2500u1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpquwpc4curk03c9wlrswe78q4eyqc7d8d0xqzpu9qrsgqhtjpauu9ur7fw2thcl4y9vfvh4m9wlfyz2gem29g5ghe2aak2pm3ps8fdhtceqsaagty2vph7utlgj48u0ged6a337aewvraedendscp573dxr',
    amountMsat: 250000000n,
    description: 'ナンセンス 1杯',
    paymentHash: SPEC_PAYMENT_HASH,
  },
  {
    // pico-BTC amount, route hint, long description
    bolt11:
      'lnbc9678785340p1pwmna7lpp5gc3xfm08u9qy06djf8dfflhugl6p7lgza6dsjxq454gxhj9t7a0sd8dgfkx7cmtwd68yetpd5s9xar0wfjn5gpc8qhrsdfq24f5ggrxdaezqsnvda3kkum5wfjkzmfqf3jkgem9wgsyuctwdus9xgrcyqcjcgpzgfskx6eqf9hzqnteypzxz7fzypfhg6trddjhygrcyqezcgpzfysywmm5ypxxjemgw3hxjmn8yptk7untd9hxwg3q2d6xjcmtv4ezq7pqxgsxzmnyyqcjqmt0wfjjq6t5v4khxsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygsxqyjw5qcqp2rzjq0gxwkzc8w6323m55m4jyxcjwmy7stt9hwkwe2qxmy8zpsgg7jcuwz87fcqqeuqqqyqqqqlgqqqqn3qq9q9qrsgqrvgkpnmps664wgkp43l22qsgdw4ve24aca4nymnxddlnp8vh9v2sdxlu5ywdxefsfvm0fq3sesf08uf6q9a2ke0hc9j6z6wlxg5z5kqpu2v9wz',
    amountMsat: 967878534n,
  },
];

/** Invalid BOLT #11 spec vectors and the error each must produce. */
export const SPEC_INVALID = [
  {
    reason: 'invalid checksum',
    error: /checksum/,
    bolt11:
      'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpquwpc4curk03c9wlrswe78q4eyqc7d8d0xqzpuyk0sg5g70me25alkluzd2x62aysf2pyy8edtjeevuv4p2d5p76r4zkmneet7uvyakky2zr4cusd45tftc9c5fh0nnqpnl2jfll544esqchsrnt',
  },
  {
    reason: 'invalid multiplier',
    error: /prefix/,
    bolt11:
      'lnbc2500x1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpusp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygs9qrsgqrrzc4cvfue4zp3hggxp47ag7xnrlr8vgcmkjxk3j5jqethnumgkpqp23z9jclu3v0a7e0aruz366e9wqdykw6dxhdzcjjhldxq0w6wgqcnu43j',
  },
  {
    reason: 'sub-millisatoshi amount',
    error: /millisatoshi/,
    bolt11:
      'lnbc2500000001p1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpusp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygs9qrsgq0lzc236j96a95uv0m3umg28gclm5lqxtqqwk32uuk4k6673k6n5kfvx3d2h8s295fad45fdhmusm8sjudfhlf6dcsxmfvkeywmjdkxcp99202x',
  },
  {
    reason: 'mixed case',
    error: /mixes/,
    bolt11:
      'LNBC2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpquwpc4curk03c9wlrswe78q4eyqc7d8d0xqzpuyk0sg5g70me25alkluzd2x62aysf2pyy8edtjeevuv4p2d5p76r4zkmneet7uvyakky2zr4cusd45tftc9c5fh0nnqpnl2jfll544esqchsrny',
  },
];
