package realtime

type Client struct {
	send chan []byte
}

func NewClient(send chan []byte) *Client {
	return &Client{send: send}
}

func (c *Client) Send() <-chan []byte { return c.send }
